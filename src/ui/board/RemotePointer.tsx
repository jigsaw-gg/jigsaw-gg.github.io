import {
  REMOTE_POINTER_ARROW_PATH,
  REMOTE_POINTER_VIEW_SIZE,
} from '../../draw/index.ts'
import type { RemoteCursor } from '../../play/useGameWorld.ts'
import { useI18n } from '../i18n/useI18n.ts'

export function RemotePointer({
  cursor,
  zoom,
}: {
  cursor: RemoteCursor
  zoom: number
}) {
  const { messages } = useI18n()
  const scale = zoom > 0 ? 1 / zoom : 1
  return (
    <div
      className="remote-cursor"
      role="img"
      aria-label={messages.play.pointer(cursor.name)}
      style={{
        left: cursor.x,
        top: cursor.y,
        color: cursor.color,
        transform: `scale(${scale})`,
      }}
    >
      <svg
        className="remote-cursor__arrow"
        width={REMOTE_POINTER_VIEW_SIZE}
        height={REMOTE_POINTER_VIEW_SIZE}
        viewBox={`0 0 ${REMOTE_POINTER_VIEW_SIZE} ${REMOTE_POINTER_VIEW_SIZE}`}
        aria-hidden="true"
      >
        <path
          d={REMOTE_POINTER_ARROW_PATH}
          fill="currentColor"
          stroke="#fff"
          strokeWidth="1"
          strokeLinejoin="round"
        />
      </svg>
      <span className="remote-cursor__name">
        <span>{cursor.name}</span>
      </span>
    </div>
  )
}
