import * as m from '@renderer/paraglide/messages';

/**
 * Localized label for an outbound (披露填报) questionnaire status.
 *
 * Single source of truth shared by the list and the detail header — the detail
 * header used to render the raw enum (`answering` / `exported`) while the list
 * showed the translated label, so they diverged. Route both through this.
 * Unknown values fall through to the raw string (defensive).
 */
export function outboundStatusLabel(status: string): string {
  switch (status) {
    case 'parsing':
      return m.questionnaires_status_parsing();
    case 'mapping':
      return m.questionnaires_status_mapping();
    case 'answering':
      return m.questionnaires_status_answering();
    case 'finalized':
      return m.questionnaires_status_finalized();
    case 'exported':
      return m.questionnaires_status_exported();
    default:
      return status;
  }
}
