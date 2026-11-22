import { createPuzzleTableCruise } from './puzzleTableCruise.ts'
import { createPuzzleTableDragPan } from './puzzleTableDragPan.ts'
import { createPuzzleTableGamepad } from './puzzleTableGamepad.ts'
import type {
  PuzzleTableActions,
  PuzzleTableInputState,
} from './puzzleTableInputState.ts'

export function wirePuzzleTableInput(
  getState: () => PuzzleTableInputState,
): PuzzleTableActions {
  const actions = {} as PuzzleTableActions
  const getActions = () => actions
  Object.assign(actions, createPuzzleTableDragPan(getState, getActions))
  Object.assign(actions, createPuzzleTableCruise(getState, getActions))
  Object.assign(actions, createPuzzleTableGamepad(getState, getActions))
  return actions
}
