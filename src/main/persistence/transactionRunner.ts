export interface TransactionStep {
  label: string
  forward: () => void | Promise<void>
  rollback: () => void | Promise<void>
}

export async function runTransaction(steps: TransactionStep[]): Promise<void> {
  const completed: TransactionStep[] = []
  try {
    for (const step of steps) {
      await step.forward()
      completed.push(step)
    }
  } catch (error) {
    for (const step of completed.reverse()) {
      try {
        await step.rollback()
      } catch (rollbackError) {
        console.error(`[transaction] rollback failed: ${step.label}`, rollbackError)
      }
    }
    throw error
  }
}

export function runTransactionSync(
  steps: Array<{
    label: string
    forward: () => void
    rollback: () => void
  }>
): void {
  const completed: typeof steps = []
  try {
    for (const step of steps) {
      step.forward()
      completed.push(step)
    }
  } catch (error) {
    for (const step of completed.reverse()) {
      try {
        step.rollback()
      } catch (rollbackError) {
        console.error(`[transaction] rollback failed: ${step.label}`, rollbackError)
      }
    }
    throw error
  }
}
