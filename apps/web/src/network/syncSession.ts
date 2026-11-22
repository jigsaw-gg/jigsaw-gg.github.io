import { create } from '@bufbuild/protobuf'
import {
  ClaimControlSchema,
  ClientEnvelopeSchema,
  CursorUpdateSchema,
  HeartbeatSchema,
  MergeGroupsSchema,
  MoveHeldSchema,
  PieceStateSchema,
  ReleaseControlSchema,
  StreamFrameSchema,
  StreamKind,
  type ClaimResult,
  type ClientEnvelope,
  type GameEvent,
  type MergeResult,
  type PresenceUpdate,
  type ServerEnvelope,
  type MotionSample,
  type StreamFrame,
  type Tick,
  type Welcome,
} from './gen/game_pb.ts'
import { event, withSpan } from '../otel/index.ts'
import { HEARTBEAT_INTERVAL_MS } from '../core/config.ts'
import { dialPlayTransport, type PlayTransport } from './playTransport.ts'
import type { PlayEndpoints, PieceStateJson } from './gameClient.ts'

export type SyncHandlers = {
  onWelcome: (welcome: Welcome) => void
  onTick: (tick: Tick) => void
  onClaimResult: (result: ClaimResult) => void
  onMergeResult: (result: MergeResult) => void
  onPresence: (presence: PresenceUpdate) => void
  onGameEvent: (event: GameEvent) => void
  onHeartbeatAck: (rttMs: number) => void
  onClose: (reason: string) => void
}

export class GameSyncSession {
  private transport: PlayTransport | null = null
  private seq = 1n
  private closed = false
  private heartbeatTimer = 0
  private pendingHeartbeat: { nonce: string; sentAt: number } | null = null
  private readonly gameId: string
  private readonly playerId: string
  private readonly handlers: SyncHandlers

  constructor(gameId: string, playerId: string, handlers: SyncHandlers) {
    this.gameId = gameId
    this.playerId = playerId
    this.handlers = handlers
  }

  get transportKind(): PlayTransport['kind'] | null {
    return this.transport?.kind ?? null
  }

  async connect(endpoints: PlayEndpoints): Promise<void> {
    if (this.closed) return
    await withSpan(
      'networking',
      'game.play.connect',
      async (span) => {
        span.setAttributes({
          'jigsaw.game.id': this.gameId,
          'jigsaw.player.id': this.playerId,
        })
        this.transport = await dialPlayTransport(endpoints, {
          onInputFrame: (frame) => this.handleFrame(frame),
          onWorldFrame: (frame) => this.handleFrame(frame),
          onClose: (reason) => {
            this.stopHeartbeat()
            event('networking', 'game.play.close', {
              'jigsaw.game.id': this.gameId,
              'jigsaw.player.id': this.playerId,
              transport: this.transport?.kind ?? 'none',
              reason,
            })
            this.handlers.onClose(reason)
          },
        })
        span.setAttribute('transport', this.transport.kind)
        this.startHeartbeat()
      },
      {
        'jigsaw.game.id': this.gameId,
        'jigsaw.player.id': this.playerId,
      },
    )
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    this.stopHeartbeat()
    const kind = this.transport?.kind ?? 'none'
    this.transport?.close()
    this.transport = null
    event('networking', 'game.play.close', {
      'jigsaw.game.id': this.gameId,
      'jigsaw.player.id': this.playerId,
      transport: kind,
      reason: 'local',
    })
  }

  sendCursor(motion: MotionSample): void {
    this.sendClient(
      StreamKind.INPUT,
      create(ClientEnvelopeSchema, {
        body: {
          case: 'cursor',
          value: create(CursorUpdateSchema, {
            motion,
          }),
        },
      }),
    )
  }

  sendClaim(
    pieceIndices: number[],
    anchorPieceIndex: number,
    clientClaimId: bigint,
  ): void {
    event('networking', 'game.claim.send', {
      'jigsaw.game.id': this.gameId,
      pieceCount: pieceIndices.length,
      anchorPieceIndex,
      clientClaimId: Number(clientClaimId),
    })
    this.sendClient(
      StreamKind.INPUT,
      create(ClientEnvelopeSchema, {
        body: {
          case: 'claim',
          value: create(ClaimControlSchema, {
            pieceIndices,
            anchorPieceIndex,
            clientClaimId,
          }),
        },
      }),
    )
  }

  sendMoveHeld(input: {
    anchorPieceIndex: number
    groupId: number
    members?: number[]
    motion: MotionSample
  }): void {
    this.sendClient(
      StreamKind.INPUT,
      create(ClientEnvelopeSchema, {
        body: {
          case: 'moveHeld',
          value: create(MoveHeldSchema, {
            anchorPieceIndex: input.anchorPieceIndex,
            groupId: input.groupId,
            memberPieceIndices: input.members ?? [],
            motion: input.motion,
          }),
        },
      }),
    )
  }

  sendRelease(poses: PieceStateJson[], pieceIndices: number[] = []): void {
    this.sendClient(
      StreamKind.INPUT,
      create(ClientEnvelopeSchema, {
        body: {
          case: 'release',
          value: create(ReleaseControlSchema, {
            pieceIndices,
            finalPoses: poses.map((pose) =>
              create(PieceStateSchema, {
                pieceIndex: pose.pieceIndex,
                xQ: pose.xQ,
                yQ: pose.yQ,
                groupId: pose.groupId,
                rev: pose.rev,
              }),
            ),
          }),
        },
      }),
    )
  }

  sendMerge(input: {
    movingGroupId: number
    targetGroupId: number
    movingMembers: number[]
    targetMembers: number[]
    movingAnchorXQ: number
    movingAnchorYQ: number
    clientMergeId: bigint
  }): void {
    event('networking', 'game.merge.send', {
      'jigsaw.game.id': this.gameId,
      movingGroupId: input.movingGroupId,
      targetGroupId: input.targetGroupId,
      movingMembers: input.movingMembers.length,
      targetMembers: input.targetMembers.length,
      clientMergeId: Number(input.clientMergeId),
    })
    this.sendClient(
      StreamKind.INPUT,
      create(ClientEnvelopeSchema, {
        body: {
          case: 'merge',
          value: create(MergeGroupsSchema, {
            movingGroupId: input.movingGroupId,
            targetGroupId: input.targetGroupId,
            movingMemberIndices: input.movingMembers,
            targetMemberIndices: input.targetMembers,
            movingAnchorXQ: input.movingAnchorXQ,
            movingAnchorYQ: input.movingAnchorYQ,
            clientMergeId: input.clientMergeId,
          }),
        },
      }),
    )
  }

  private sendClient(stream: StreamKind, partial: ClientEnvelope): void {
    if (!this.transport || this.closed) return
    const seq = this.seq
    this.seq += 1n
    const envelope = create(ClientEnvelopeSchema, {
      ...partial,
      gameId: this.gameId,
      playerId: this.playerId,
      seq,
      clientTimeMs: BigInt(Math.floor(performance.now())),
    })
    const frame = create(StreamFrameSchema, {
      stream,
      seq,
      timeMs: BigInt(Date.now()),
      body: { case: 'client', value: envelope },
    })
    if (stream === StreamKind.WORLD) this.transport.sendWorld(frame)
    else this.transport.sendInput(frame)
  }

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = window.setInterval(() => {
      const nonce = crypto.randomUUID().slice(0, 8)
      this.pendingHeartbeat = { nonce, sentAt: performance.now() }
      this.sendClient(
        StreamKind.INPUT,
        create(ClientEnvelopeSchema, {
          body: {
            case: 'heartbeat',
            value: create(HeartbeatSchema, { nonce }),
          },
        }),
      )
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = 0
    }
  }

  private handleFrame(frame: StreamFrame): void {
    if (frame.body.case !== 'server') return
    this.dispatchServer(frame.body.value)
  }

  private dispatchServer(envelope: ServerEnvelope): void {
    switch (envelope.body.case) {
      case 'welcome': {
        const welcome = envelope.body.value
        event('networking', 'game.play.welcome', {
          'jigsaw.game.id': this.gameId,
          'jigsaw.player.id': this.playerId,
          transport: this.transport?.kind ?? 'none',
          playerCount: welcome.players.length,
          holdingCount: welcome.holdings.length,
          hasBoard: Boolean(welcome.board),
          boardPieces: welcome.board?.pieces.length ?? 0,
        })
        this.handlers.onWelcome(welcome)
        break
      }
      case 'tick':
        // High-frequency — leave silent; board truth is observable via UI.
        this.handlers.onTick(envelope.body.value)
        break
      case 'claimResult': {
        const result = envelope.body.value
        event('networking', 'game.claim.result', {
          'jigsaw.game.id': this.gameId,
          accepted: result.accepted,
          granted: result.grantedPieceIndices.length,
          denied: result.deniedPieceIndices.length,
          clientClaimId: Number(result.clientClaimId),
          holderPlayerId: result.holderPlayerId || undefined,
        })
        this.handlers.onClaimResult(result)
        break
      }
      case 'mergeResult': {
        const result = envelope.body.value
        event('networking', 'game.merge.result', {
          'jigsaw.game.id': this.gameId,
          accepted: result.accepted,
          clientMergeId: Number(result.clientMergeId),
          resultingGroupId: result.resultingGroupId,
          rejectReason: result.rejectReason || undefined,
        })
        this.handlers.onMergeResult(result)
        break
      }
      case 'presence': {
        const presence = envelope.body.value
        event('networking', 'game.presence', {
          'jigsaw.game.id': this.gameId,
          playerCount: presence.players.length,
          removed: presence.removedPlayerIds.length,
        })
        this.handlers.onPresence(presence)
        break
      }
      case 'gameEvent': {
        const gameEvent = envelope.body.value
        event('networking', 'game.event', {
          'jigsaw.game.id': this.gameId,
          kind: gameEvent.kind,
          hasBoard: Boolean(gameEvent.board),
        })
        this.handlers.onGameEvent(gameEvent)
        break
      }
      case 'heartbeatAck': {
        const ack = envelope.body.value
        if (
          this.pendingHeartbeat &&
          this.pendingHeartbeat.nonce === ack.nonce
        ) {
          const rtt = Math.round(
            performance.now() - this.pendingHeartbeat.sentAt,
          )
          this.pendingHeartbeat = null
          // Only emit when RTT looks unhealthy — avoids 2.5s spam.
          if (rtt >= 200) {
            event('networking', 'game.heartbeat.slow', {
              'jigsaw.game.id': this.gameId,
              rttMs: rtt,
            })
          }
          this.handlers.onHeartbeatAck(rtt)
        }
        break
      }
      default:
        break
    }
  }
}
