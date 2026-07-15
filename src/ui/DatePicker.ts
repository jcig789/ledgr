/**
 * Themed date picker for Ledgr modals.
 * Uses native <input type="date"> with CSS overrides to match the old money design.
 * Falls back gracefully on platforms that don't support date inputs.
 */

export function createDateInput(
  parent: HTMLElement,
  value: string,
  onChange: (v: string) => void
): HTMLInputElement {
  const wrapper = parent.createDiv("ledgr-date-wrapper");
  const input = wrapper.createEl("input");
  input.type = "date";
  input.value = value;
  input.className = "ledgr-date-input";

  // Native date input fires "change" not "input"
  input.addEventListener("change", () => {
    if (input.value) onChange(input.value);
  });
  // Also handle manual text entry
  input.addEventListener("input", () => {
    if (input.value && window.moment(input.value, "YYYY-MM-DD", true).isValid()) {
      onChange(input.value);
    }
  });

  return input;
}
