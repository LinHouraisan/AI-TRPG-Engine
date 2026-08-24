export function createSubmissionGate() {
  let held = false;
  return {
    async run(task: () => Promise<boolean>): Promise<boolean> {
      if (held) return false;
      held = true;
      try {
        return await task();
      } finally {
        held = false;
      }
    },
  };
}

export function createInvestigatorConfirmationGate() {
  return createSubmissionGate();
}
