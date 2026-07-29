import * as m from '@renderer/paraglide/messages';
import type { TourId } from './guidance-state';

/**
 * Where every guidance tour points and what it says.
 *
 * One file on purpose: anchors drift when pages are re-laid-out (the UI/UX
 * redesign backlog explicitly warns about this), so keeping all selectors
 * in a single place means a re-anchor is one diff, not a hunt through five
 * routes. Selectors are `[data-tour="…"]` attributes we own — the single
 * exception is `.report-preview__scope-table`, an existing semantic class
 * the PDF renderer already depends on.
 *
 * Copy lives in paraglide messages and is read at render time (getters,
 * not strings) so switching locale re-renders the tooltip in place.
 */

export interface GuidanceStep {
  /** CSS selector for the element to spotlight. */
  target: string;
  title: () => string;
  body: () => string;
  /** Joyride placement; defaults to 'auto'-ish bottom when omitted. */
  placement?: 'top' | 'bottom' | 'left' | 'right' | 'center';
}

export interface TourDefinition {
  id: TourId;
  steps: GuidanceStep[];
  /**
   * Drop the dimming overlay. Used for tours that play inside a drawer —
   * the drawer already dims the page behind it, and a `position: fixed`
   * overlay portalled into vaul's transformed content would size itself
   * to the drawer rather than the viewport.
   */
  hideOverlay?: boolean;
  /**
   * Render the tooltip inside this element instead of `document.body`.
   * Required inside Radix/vaul modals: their focus trap sets
   * `pointer-events: none` outside the content, which would leave the
   * tooltip's buttons unclickable.
   */
  portalTarget?: string;
}

export function getTour(id: TourId): TourDefinition {
  switch (id) {
    case 'questionnaires':
      return {
        id,
        steps: [
          {
            target: '[data-tour="questionnaire-new"]',
            title: m.guidance_questionnaires_new_title,
            body: m.guidance_questionnaires_new_body,
            placement: 'bottom',
          },
          {
            target: '[data-tour="questionnaire-list"]',
            title: m.guidance_questionnaires_list_title,
            body: m.guidance_questionnaires_list_body,
            placement: 'right',
          },
        ],
      };

    case 'extraction':
      return {
        id,
        steps: [
          {
            target: '[data-tour="extraction-stage"]',
            title: m.guidance_extraction_stage_title,
            body: m.guidance_extraction_stage_body,
            placement: 'left',
          },
          {
            target: '[data-tour="extraction-actions"]',
            title: m.guidance_extraction_actions_title,
            body: m.guidance_extraction_actions_body,
            placement: 'top',
          },
          {
            target: '[data-tour="extraction-switch-stage"]',
            title: m.guidance_extraction_switch_title,
            body: m.guidance_extraction_switch_body,
            placement: 'top',
          },
        ],
      };

    case 'answer-review':
      return {
        id,
        steps: [
          {
            target: '[data-tour="answer-card"]',
            title: m.guidance_answer_card_title,
            body: m.guidance_answer_card_body,
            placement: 'left',
          },
          {
            target: '[data-tour="answer-actions"]',
            title: m.guidance_answer_actions_title,
            body: m.guidance_answer_actions_body,
            placement: 'left',
          },
          {
            target: '[data-tour="questionnaire-actions"]',
            title: m.guidance_answer_bulk_title,
            body: m.guidance_answer_bulk_body,
            placement: 'top',
          },
        ],
      };

    case 'ef-rebind':
      return {
        id,
        hideOverlay: true,
        portalTarget: '[data-tour-portal="rebind-drawer"]',
        steps: [
          {
            target: '[data-tour="rebind-current"]',
            title: m.guidance_rebind_current_title,
            body: m.guidance_rebind_current_body,
            placement: 'left',
          },
          {
            target: '[data-tour="rebind-picker"]',
            title: m.guidance_rebind_picker_title,
            body: m.guidance_rebind_picker_body,
            placement: 'left',
          },
          {
            target: '[data-tour="rebind-confirm"]',
            title: m.guidance_rebind_confirm_title,
            body: m.guidance_rebind_confirm_body,
            placement: 'top',
          },
        ],
      };

    case 'report-export':
      return {
        id,
        steps: [
          {
            target: '.report-preview__scope-table',
            title: m.guidance_report_scope_title,
            body: m.guidance_report_scope_body,
            placement: 'top',
          },
          {
            target: '[data-tour="report-export"]',
            title: m.guidance_report_export_title,
            body: m.guidance_report_export_body,
            placement: 'bottom',
          },
          {
            target: '[data-tour="report-deliverable"]',
            title: m.guidance_report_deliverable_title,
            body: m.guidance_report_deliverable_body,
            placement: 'bottom',
          },
        ],
      };
  }
}
