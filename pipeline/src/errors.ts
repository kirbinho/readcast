/** Fehler, deren Text ohne Inhalte ist und deshalb ins öffentliche Protokoll darf. */
export class SafeError extends Error {}

/** Die Kostengrenze dieses Laufs ist erreicht. */
export class RunLimitError extends SafeError {}
