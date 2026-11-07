// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import RecoveryCandidateDialog from "./RecoveryCandidateDialog";

it("traps keyboard focus and restores it when the recovery picker closes", () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  const onCancel = vi.fn();
  const { unmount } = render(
    <RecoveryCandidateDialog
      listing={{
        candidates: [{
          id: "a".repeat(64),
          projectId: "project-one",
          kind: "active",
          name: "Current recovery",
          generation: 7,
          fingerprint: "b".repeat(64),
        }],
        warnings: [],
        truncated: false,
      }}
      onSelect={vi.fn()}
      onCancel={onCancel}
    />,
  );
  const candidate = screen.getByRole("button", { name: /เปิดรายการนี้/ });
  const cancel = screen.getByRole("button", { name: "ยกเลิก" });
  expect(document.activeElement).toBe(candidate);

  fireEvent.keyDown(candidate, { key: "Tab", shiftKey: true });
  expect(document.activeElement).toBe(cancel);
  fireEvent.keyDown(cancel, { key: "Tab" });
  expect(document.activeElement).toBe(candidate);
  fireEvent.keyDown(candidate, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledOnce();

  unmount();
  expect(document.activeElement).toBe(trigger);
  trigger.remove();
});
