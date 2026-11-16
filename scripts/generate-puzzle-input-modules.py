#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "dev/restructure/puzzleTable-input-extract-source.tsx"
OUT = ROOT / "src/ui/board/puzzleTable"

RANGES = {
    "puzzleTableDragPan.ts": (710, 1387),
    "puzzleTableGamepad.ts": (1389, 1885),
    "puzzleTableCruise.ts": (1886, 2074),
}

STATE_IDENTS = [
    "viewportRef",
    "placementsRef",
    "layout",
    "area",
    "active",
    "dragRef",
    "followRef",
    "viewRef",
    "setView",
    "onPointer",
    "onDrag",
    "onDragEnd",
    "onDragCancel",
    "padGroupRef",
    "interestRef",
    "boardLockedRef",
    "pinchActiveRef",
    "panRef",
    "userAdjustedRef",
    "offsetsRef",
    "slideFrameRef",
    "setOffsets",
    "setPlacements",
    "setFrontGroup",
    "setDragGroup",
    "setNear",
    "setPulses",
    "handoverTimerRef",
    "handoverRef",
    "setHandover",
    "cruiseStickRef",
    "setCruiseStick",
    "stickFrameRef",
    "stickTickRef",
    "setPanStick",
    "setPanning",
    "selectionRef",
    "padHoverRef",
    "padPointerRef",
    "padHoverIdRef",
    "setPadGroup",
    "setPadHoverGroup",
    "setPadPointer",
    "cruiseRef",
    "cruiseFrameRef",
    "cruiseTickRef",
    "padClockRef",
    "blinkRef",
    "connectedRef",
    "helpOpenRef",
    "setGamepadConnected",
    "setGamepadBlink",
    "setGamepadHelpOpen",
]

DRAG_PAN_EXPORTS = [
    "present",
    "commitView",
    "playPoint",
    "publishPointer",
    "finishDrag",
    "rememberMembers",
    "beginSlide",
    "launchSnap",
    "pulseGroup",
    "twoThumbNow",
    "clearHandover",
    "syncHandover",
    "showCruiseStick",
    "cruiseStickView",
    "publishPanStick",
    "pokeStickPan",
    "stickPanTick",
    "lockHeldPiece",
    "endPan",
    "stopPan",
    "onViewportPointerDown",
    "onViewportPointerMove",
    "onViewportPointerMoveCapture",
    "onPointerDown",
    "onPointerMove",
    "moveDragTo",
    "moveDragToWorld",
]

GAMEPAD_EXPORTS = [
    "viewportSize",
    "cameraForViewport",
    "revealGroup",
    "clearPadSelection",
    "selectHoveredPad",
    "syncPadPointer",
    "hoverJump",
    "beginGamepadDrag",
    "moveDragBy",
    "gamepadTick",
]

CRUISE_EXPORTS = [
    "beginCruise",
    "pokeCruise",
    "cruiseTick",
    "easeCruiseZoom",
]

CROSS_TO_ACTIONS: dict[str, list[str]] = {
    "puzzleTableDragPan.ts": ["beginCruise", "pokeCruise"],
    "puzzleTableGamepad.ts": [
        "finishDrag",
        "moveDragToWorld",
        "present",
        "commitView",
    ],
    "puzzleTableCruise.ts": [
        "showCruiseStick",
        "cruiseStickView",
        "moveDragTo",
        "publishPointer",
        "commitView",
    ],
}


def strip_use_effects(text: str) -> str:
    """Drop useEffect(...) blocks; they stay in PuzzleTable."""
    out: list[str] = []
    i = 0
    lines = text.splitlines()
    while i < len(lines):
        line = lines[i]
        if re.match(r"useEffect\(", line.strip()):
            depth = line.count("(") - line.count(")")
            i += 1
            while i < len(lines) and depth > 0:
                depth += lines[i].count("(") - lines[i].count(")")
                i += 1
            continue
        out.append(line)
        i += 1
    return "\n".join(out)


def transform_state(text: str) -> str:
    for ident in sorted(STATE_IDENTS, key=len, reverse=True):
        text = re.sub(rf"(?<!s\(\)\.){re.escape(ident)}\b", f"s().{ident}", text)
    return text


def transform_cross(text: str, names: list[str]) -> str:
    for name in sorted(names, key=len, reverse=True):
        text = re.sub(rf"(?<![.\w]){re.escape(name)}(?=\()", f"a().{name}", text)
    return text


def extract_block(start: int, end: int) -> str:
    lines = SRC.read_text().splitlines()
    block = "\n".join(lines[start - 1 : end])
    block = "\n".join(line[2:] if line.startswith("  ") else line for line in block.splitlines())
    return strip_use_effects(block)


def factory_name(file: str) -> str:
    if file == "puzzleTableDragPan.ts":
        return "createPuzzleTableDragPan"
    if file == "puzzleTableGamepad.ts":
        return "createPuzzleTableGamepad"
    return "createPuzzleTableCruise"


def exports_for(file: str) -> list[str]:
    if file == "puzzleTableDragPan.ts":
        return DRAG_PAN_EXPORTS
    if file == "puzzleTableGamepad.ts":
        return GAMEPAD_EXPORTS
    return CRUISE_EXPORTS


def type_name(file: str) -> str:
    if file == "puzzleTableDragPan.ts":
        return "PuzzleTableDragPanActions"
    if file == "puzzleTableGamepad.ts":
        return "PuzzleTableGamepadActions"
    return "PuzzleTableCruiseActions"


HEADERS = {
    "puzzleTableDragPan.ts": """import type { EdgePull } from './edgeCruise.ts'
import { GAMEPAD_POINTER } from '../../input/dualshock.ts'
import { VIEW_MARGIN, piecesVisible, groupWorldBounds, cameraWithInterest } from '../../input/gamepadView.ts'
import { CRUISE_MAX_SPEED } from './edgeCruise.ts'
import { event as otelEvent } from '../../otel/index.ts'
import {
  approachLimits,
  cameraLimits,
  clampGroup,
  moveGroup,
  pullToNeighbors,
  type Camera,
  type Placement,
} from '../../world/placement.ts'
import {
  HANDOVER_MS,
  handoverMarks,
  oppositeThumb,
  stickDeflection,
  stickDisc,
  STICK_MAX_SPEED,
  thumbSide,
  twoThumbLayout,
} from './twoThumb.ts'
import { hapticImpact } from '../../telegram/webApp.ts'
import type { HandoverView, ThumbStickView } from './boardChrome.tsx'
import {
  MOBILE_LAYOUT,
  allowsMotion,
  settleSlide,
  slideResting,
  type Drag,
} from './puzzleTableShared.ts'
import type { PuzzleTableActions, PuzzleTableInputState } from './puzzleTableInputState.ts'
""",
    "puzzleTableGamepad.ts": """import { GAMEPAD_POINTER } from '../../input/dualshock.ts'
import { getState as getGamepadState } from '../../input/gamepadHandler.ts'
import {
  PAN_SPEED_PX,
  PIECE_SPEED_PX,
  POINTER_SPEED_PX,
  TRIGGER_ZOOM_PER_SEC,
  VIEW_MARGIN,
  boundsVisible,
  cameraWithInterest,
  groupAtWorld,
  groupScreenCenter,
  groupWorldBounds,
  lookOffset,
  pickGroupInDirection,
  piecesVisible,
  type PadDirection,
} from '../../input/gamepadView.ts'
import { cameraLimits, zoomCamera } from '../../world/placement.ts'
import { GAMEPAD_BLINK_MS, GAMEPAD_RELEASE_S } from './puzzleTableShared.ts'
import type { PuzzleTableActions, PuzzleTableInputState } from './puzzleTableInputState.ts'
""",
    "puzzleTableCruise.ts": """import { isExpanded } from '../../fullscreen.ts'
import {
  CRUISE_MAX_SPEED,
  createCruise,
  cruiseMargin,
  cruiseVelocity,
  cruiseZoom,
  edgePull,
  stepCruise,
} from './edgeCruise.ts'
import { cameraLimits, zoomCamera, type Camera } from '../../world/placement.ts'
import { halfEdgeBounds } from './twoThumb.ts'
import { allowsMotion, cruiseLive, touchEdgeBounds, type ActiveCruise } from './puzzleTableShared.ts'
import type { PuzzleTableActions, PuzzleTableInputState } from './puzzleTableInputState.ts'
""",
}


def main() -> None:
    for file, (start, end) in RANGES.items():
        body = extract_block(start, end)
        body = transform_state(body)
        body = transform_cross(body, CROSS_TO_ACTIONS.get(file, []))
        exports = exports_for(file)
        ret = ",\n    ".join(exports)
        fn = factory_name(file)
        tn = type_name(file)
        content = (
            HEADERS[file]
            + f"\nexport type {tn} = Pick<PuzzleTableActions, "
            + "|".join(f"'{e}'" for e in exports)
            + ">\n\n"
            + f"export function {fn}(\n"
            + "  s: () => PuzzleTableInputState,\n"
            + "  a: () => PuzzleTableActions,\n"
            + f"): {tn} {{\n"
            + body
            + f"\n  return {{\n    {ret},\n  }}\n}}\n"
        )
        (OUT / file).write_text(content)
        print(file, "lines", content.count("\n") + 1)


if __name__ == "__main__":
    main()
