import { within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/**
 * Gives a reason as staff do on a ReasonPicker: its button when it is on the
 * place's list, else "Another reason" and typing (added to what is typed
 * already, if the box is open).
 */
export async function giveReason(testIdPrefix: string, reason: string, scope: HTMLElement = document.body): Promise<void> {
  const area = within(scope);
  const listed = area.queryByRole("radio", { name: reason });
  if (listed) {
    await userEvent.click(listed);
    return;
  }
  if (!area.queryByTestId(`${testIdPrefix}-text`)) await userEvent.click(area.getByTestId(`${testIdPrefix}-other`));
  await userEvent.type(area.getByTestId(`${testIdPrefix}-text`), reason);
}
