# Organisations design QA

The source is the selected Organisations mockup, saved as `frontend/test-results/organisations-reference.png`. The rendered sample-data directory is `frontend/test-results/organisations-desktop.png`. Both use a 1487 × 1058 pixel canvas. The browser used a 1487 × 1058 CSS viewport at device scale factor 1. The mobile capture at `frontend/test-results/organisations-mobile.png` is 390 × 1090 pixels from a 390 × 844 CSS viewport at device scale factor 1.

The desktop comparison shows the light-theme system administrator view with Sri Lanka selected, the partner tab active and the add form closed. `frontend/test-results/organisations-overview-comparison.png` pairs the full views. `frontend/test-results/organisations-directory-comparison.png` compares the same crop around the header, tabs, search, table and actions. The reference is on the left in both comparisons.

- **Typography** uses Surakuma’s Outfit family and existing Admin heading scale. The initial comparison showed small tab and table labels against the mockup. The revised capture shows larger tab labels and clearer emphasis on organisation names and column headings. The shared workspace headings retain the app-wide scale.
- **Spacing and layout** follow the selected tab bar, full-width search and two-column directory. The directory includes workflow guidance and a second line for crisis responsibilities. The revised mobile capture shows the add button above the wrapping tabs and country actions within the table width.
- **Colours** use Surakuma’s coral primary action, blue selected tab and enable actions, white directory and blue-grey workspace. The Admin shell uses its existing focus and selected styles.
- **Assets** reuse Surakuma’s rendered logo and existing icon library. The comparison shows a crisp logo, search icon and button icon at the rendered scale.
- **Copy** names the selected country and describes what enablement unlocks. A sample enabled partner demonstrates the active crisis and next-step actions. The other two sample rows demonstrate the enable action from the mockup.

Browser checks covered search, adding and enabling a sample partner, country changes, staff organisation selection, choosing a crisis routing destination, and navigating to both settings tabs. No browser console errors were reported in the sample preview. API integration tests used isolated SQL Server data.

final result: passed

## Users & access action controls

Compared the selected dark mockup with the live dark Users & access page, with a Country Administrator row expanded. The focused side-by-side capture is stored as account-actions-comparison.png in this chat's visualization folder. It excludes account names and email addresses.

The initial capture showed the Access column shifting right after the standalone revoke buttons were removed. Preserving its column width brought the pill and dropdown back into alignment. The final comparison shows the rounded fill, expanded chevron, blue selected border, slate dropdown and coral role revoke treatment. The live menu also keeps the existing permanent deletion action where permitted, so it is taller than the reference.

Browser checks confirmed that the dropdown stays inside the viewport, revoke opens a confirmation that can be cancelled, and Escape restores focus to the Actions button. Light and dark themes were checked. The production build and all 42 frontend tests passed, including the role revoke and typed account deletion confirmation flows. Browser checks did not submit changes to any account.

final result: passed

## Compact Users & access directory

Compared the selected mockup on the left with the live dark directory on the right in this chat's compact-users-comparison.png. The capture substitutes sample names and email addresses. Live dates and statuses come from the directory, and the live page still shows up to ten accounts per page.

The initial capture showed the user ID control increasing row height to about 119 px. Moving it beside the account name and making the disclosure compact brought ordinary rows to about 74 px. Longer identities and multiple grants can wrap. The final comparison shows the account name and email combined beneath the Account header, plain role labels above their organisation and scope, and separate Status, Created and Access columns. Real status text distinguishes disabled, suspended and partially suspended accounts, and fallback dates stay marked First recorded.

The live browser showed the revised table in both themes and the existing Role access menu. Automated checks covered search, filtering, pagination, distinct role scopes, mixed suspension and account action confirmations. All 42 frontend tests passed before the spacing correction. The 13 focused tests and production build passed afterward.

final result: passed

## Workspace Back and Home

The selected paired-button mockup and the rendered light header are shown side by side in this chat's workspace-back-home-comparison.png. The workspace uses the existing Outfit typeface and icons, a rounded outline and divider, and a lightly tinted Home segment. The capture shows the live hover state on Home.

Chrome confirmed that Back returns from Users & access to the previous admin page while Home opens the public homepage. The header's visible controls fit at a 320 CSS pixel viewport. Automated coverage confirmed the workspace overview fallback for a direct visit and browser-history navigation after an internal link. All 43 frontend tests and the production build passed.

final result: passed

## Homepage help timeline

The [selected design](C:/Users/infos/AppData/Local/Temp/codex-clipboard-cd2e604d-f2fd-4cda-a883-34f94e0af776.png) is above the rendered section in the [Edge comparison](C:/Users/infos/.codex/visualizations/2026/11/15/01a1df48-d759-7961-98db-8bc48a1e1327/help-timeline-comparison.png). The source is a 1097 × 332 crop. The rendered light section is a native 1082 × 346 crop from an approximately 1098 CSS pixel viewport, excluding the scrollbar. The comparison uses native pixel sizes and omits browser chrome. The section crops give a readable view of the headings, connector, copy and both actions.

The initial capture had a smaller heading and more top padding than the selected design. The final capture shows a stronger Outfit heading and a tighter top inset. Both use the same three steps, pastel number tiles, fine connecting line and paired actions. The implementation follows the site's container grid and uses navy text on the coral button to match the existing primary button and preserve contrast. The section contains live text and CSS layout, with no raster assets in the reference to reproduce. The remaining small differences in side margins and line breaks follow the live site's grid and fonts.

The [dark desktop capture](C:/Users/infos/.codex/visualizations/2026/11/15/01a1df48-d759-7961-98db-8bc48a1e1327/help-timeline-dark.jpg) uses the existing dark surfaces and a theme-appropriate connector. The [mobile capture](C:/Users/infos/.codex/visualizations/2026/11/15/01a1df48-d759-7961-98db-8bc48a1e1327/help-timeline-mobile.jpg) shows the stacked steps and actions at a 390 CSS pixel viewport. Edge showed no page-width overflow. Both links reached login from the signed-out homepage. The destinations are the existing new request form and My requests list, respectively. The existing authentication flow preserves the selected destination. The Edge tab recorded no console warnings or errors during verification.

final result: passed

## Contact & support emergency contacts

The [selected mockup](C:/Users/infos/.codex/generated_images/01a1df48-d759-7961-98db-8bc48a1e1327/exec-09f8d877-a71d-4c51-a1a3-43cbaea5086d.png) appears to the left of the rendered dark page in the [full comparison](C:/Users/infos/.codex/visualizations/2026/11/15/01a1df48-d759-7961-98db-8bc48a1e1327/contact-option-1-comparison.jpg) and [main content comparison](C:/Users/infos/.codex/visualizations/2026/11/15/01a1df48-d759-7961-98db-8bc48a1e1327/contact-option-1-comparison-detail.jpg). The source is 1710 × 920 pixels. Edge used a 1710 × 920 CSS pixel viewport and returned a 1695 × 912 JPEG. The full comparison applies the same scaling to both images. The focused comparison uses native crops. Both views show the Sri Lanka page in English while signed out.

The two contact cards, large telephone numbers, official source links and full-width support panel match the selected hierarchy. The implementation uses the existing Outfit scale, shared Lucide icons and theme surfaces. The coral buttons retain the site's dark text for contrast. The country configuration supplies the service labels, including the shorter live Ambulance label. The support panel keeps one Request help label on its action. The site header and footer follow the existing grid.

The first 320 CSS pixel capture exposed a shared public header overflow. The compact header now uses the existing brand mark and retains the country, language, theme and menu controls. Edge verified that the menu opens and document width stays within the viewport in the [revised 320 view](C:/Users/infos/.codex/visualizations/2026/11/15/01a1df48-d759-7961-98db-8bc48a1e1327/contact-option-1-narrow.jpg). The emergency cards and support actions stack in the [390 view](C:/Users/infos/.codex/visualizations/2026/11/15/01a1df48-d759-7961-98db-8bc48a1e1327/contact-option-1-mobile.jpg). The [light desktop capture](C:/Users/infos/.codex/visualizations/2026/11/15/01a1df48-d759-7961-98db-8bc48a1e1327/contact-option-1-light.jpg) shows the same content order.

Edge verified that Sri Lanka, Nepal and India replace the displayed contacts and telephone destinations when the country changes. The request links reached login while signed out and Safety guidance opened its existing page. One React warning appeared after a live edit and did not recur on a clean reload. Type checking, 45 frontend tests and the production build passed.

final result: passed



## Partner directory, country settings and cross-border incidents redesign

The six selected images are archived as `reference-*.png` in `frontend/test-results/organisations-redesign`. The matching renders use a 1487 × 1058 CSS viewport and PNG capture in the in-app browser. The directory reference is 1487 × 1058, the incident list reference is 1511 × 1041, and the interaction boards are 1536 × 1024. The comparison files put the source on the left and the rendered app on the right. Full-view sheets preserve aspect ratio. Focused sheets crop the corresponding controls and preserve aspect ratio so labels and actions remain readable.

- The [Nepal directory](frontend/test-results/organisations-redesign/partners-nepal-full-comparison.png) preserves the split, selected row, two detail rows, actions and ID disclosure. The preview uses a sample extra partner. A [pending partner](frontend/test-results/organisations-redesign/pending-nepal.png) shows its status in both panes and explains when staff and routing actions become available. At [390 CSS pixels](frontend/test-results/organisations-redesign/partners-india-mobile.png) both panes stack. All three tabs fit the viewport width.
- The [verification comparison](frontend/test-results/organisations-redesign/verification-nepal-focus-comparison.png) shows the editable evidence and decision controls from the selected reference. The first render used smaller labels and compact buttons. The revised render uses larger labels, shorter gaps and equal-width decision buttons. The existing Outfit type, blue links, green verified status and text labels are used in both panes.
- The [country settings comparison](frontend/test-results/organisations-redesign/country-nepal-full-comparison.png) shows the language matrix, locked English controls and emergency contacts. The desktop form uses two columns and the sections stack on mobile. The first new contact form placed name and telephone side by side and separated the two footer actions. The [revised form](frontend/test-results/organisations-redesign/country-add-contact-focus-comparison.png) stacks all three fields and places Cancel beside Request approval. The browser showed Pending approval after submitting a sample proposal.
- The [Sri Lanka incidents comparison](frontend/test-results/organisations-redesign/incidents-lk-full-comparison.png) shows the selected country's linked crisis count and the two entry actions. The [create form](frontend/test-results/organisations-redesign/incident-create-focus-comparison.png), [link form](frontend/test-results/organisations-redesign/incident-link-focus-comparison.png), [incident detail](frontend/test-results/organisations-redesign/incident-details-focus-comparison.png), [unlink confirmation](frontend/test-results/organisations-redesign/incident-unlink-focus-comparison.png) and [delete confirmation](frontend/test-results/organisations-redesign/incident-delete-focus-comparison.png) show the click states. The ID is selectable for manual copying. Confirmations use the existing danger treatment, and their copy explains that national crises are kept. The unlink wording applies to open and ended crises.
- The app keeps the existing Surakuma brand, Lucide icons, grid, background and theme tokens. Small size and margin differences reflect the existing workspace components. Selectable names, counts, evidence and incident details come from the active country. The captures use sample data.

Browser checks covered country switching, partner creation and verification, settings and contact proposal, incident creation, copy ID, cross-country linking, unlink cancellation and deletion of an eligible sample incident. No browser console errors were observed. The production build, 46 frontend unit tests and three mocked international browser tests passed. Live API writes were not exercised.

final result: passed

## Integrations dashboard split view

- Visual reference: C:/Users/infos/AppData/Local/Temp/codex-clipboard-38f9c545-c756-4883-8378-4de093627004.png (1602 × 982 pixels).
- Browser capture: C:/Users/infos/.codex/visualizations/2026/11/15/01a1e052-757c-71c2-99a7-230ac628189a/integrations-desktop.jpg (1832 × 1086 pixels, full page). Desktop CSS viewport 1847 × 1050, device pixel ratio 1. Cropped the workspace shell and scrollbar before comparing the 1587 × 1004 content region to the reference.
- State: system administrator, dark theme, Sri Lanka selected, ready state with sample Fallback, Configured and Unavailable providers, and Captured and Sent queue totals.
- Full comparison: integrations-desktop-comparison.jpg, reference on the left. Focused comparison: integrations-readiness-comparison.jpg, provider rows and status labels. Both are in the visualization folder above. Captured the 390 × 844 viewport in integrations-mobile.jpg and integrations-mobile-queue.jpg.

**Findings and iteration**

- [P2, resolved] The initial render used the full provider explanations and a long footer, sending the queue action below the target viewport. The initial evidence is integrations-initial-comparison.jpg. The revised render condenses the known provider states, keeps other provider details from the API, and brings the action back into view. Status labels, provider names and missing setting names remain visible.
- Typography uses the loaded Outfit family and preserves the reference hierarchy. The matched layout uses an approximately 60:40 split, with both panels aligned and the queue action at the bottom. The panels stack on mobile with no horizontal overflow. Navy surfaces and colored chips follow the reference. Surakuma's existing Lucide icons provide a close match for the standard symbols. The page keeps the app's workspace navigation and reports the actual refresh time and selected-country counts.
- [P3] The rendered panel bottom is about 29 pixels lower than the reference after normalizing the shell. A few explanatory labels are slightly smaller. The entire desktop dashboard and its actions remain visible at the comparable viewport.

**Checks**

- Refresh status changed the displayed timestamp. Changing the sample country replaced its queue totals. View Activity opened the Activity section. There were no browser console errors in the verified flow.
- The local preview used sample API responses. The production build and all 59 frontend tests passed.

final result: passed

## Operational reports, Phase 1

The selected reference and the light-theme System Administrator capture use the same 1672 × 941 viewport and the multi-country, all-crises state. The capture reads an isolated SQL Server LocalDB database with development fixtures. [Full comparison](C:/Users/infos/.codex/visualizations/2026/11/16/01a1e4aa-a705-71e0-a7ac-f42255005d09/reports-comparison.png)

- The [focused comparison](C:/Users/infos/.codex/visualizations/2026/11/16/01a1e4aa-a705-71e0-a7ac-f42255005d09/reports-filter-tables-comparison.png) shows the filter strip, coral CSV and outlined PDF actions, six KPI cards, side-by-side panels, and shaded country total. The page uses the loaded Outfit family, the existing workspace shell, and Lucide icons. The stock table adds on-hand and reserved quantities alongside available stock. Its country columns and figures reflect the stored records.
- The initial desktop render pushed the snapshot time below the comparable viewport. The revision reduced padding, used a shorter stock cell, and aligned the definitions alongside the heading. The snapshot time is visible in the final [desktop capture](C:/Users/infos/.codex/visualizations/2026/11/16/01a1e4aa-a705-71e0-a7ac-f42255005d09/reports-desktop.png).
- At 390 CSS pixels, the sections stack, the crisis filter fills its row, and both tables scroll inside their panels. The browser measured zero page-width overflow. [Mobile capture](C:/Users/infos/.codex/visualizations/2026/11/16/01a1e4aa-a705-71e0-a7ac-f42255005d09/reports-mobile.png)
- The isolated browser run checked country and crisis filters, the empty case state, multi-country totals, both downloads, and agreement between the CSV and on-screen totals. The reference includes simulated comparisons. The browser fixture has zero submissions in the preceding period, so it shows no percentage.

final result: passed

## Resources & Logistics

The reference and light-theme System Administrator capture both use a 1672 × 941 viewport. The capture shows **All countries** with data from an isolated SQL Server LocalDB fixture. [Full comparison](C:/Users/infos/.codex/visualizations/2026/11/16/01a1e4aa-a705-71e0-a7ac-f42255005d09/logistics-full-comparison.png)

- The layout uses the existing Surakuma navigation and Outfit font, three header actions, five KPI cards, a filter strip, and a two-column inventory and activity layout. The first pass pushed pagination and alerts below the reference viewport. Tighter card spacing and a compact quantity column brought both into view. [Detail comparison](C:/Users/infos/.codex/visualizations/2026/11/16/01a1e4aa-a705-71e0-a7ac-f42255005d09/logistics-focus-comparison.png)
- Figures are calculated from authorised records. For mixed inventory units, the available and reserved KPIs count items with stock or reservations. The demo trends from the reference are omitted because there are no comparable historical snapshots.
- At 390 × 844, filters and action buttons wrap and the activity cards stack. The inventory table scrolls within its panel, and the page has no horizontal overflow. [Mobile](C:/Users/infos/.codex/visualizations/2026/11/16/01a1e4aa-a705-71e0-a7ac-f42255005d09/logistics-mobile.png), [mobile dark mode](C:/Users/infos/.codex/visualizations/2026/11/16/01a1e4aa-a705-71e0-a7ac-f42255005d09/logistics-mobile-dark.png)
- The browser run verified resource registration, receipt, reservation, dispatch and delivery, movement history, transfers, country filters, low-stock alerts, CSV, and inventory pagination. The backend suite checked concurrent reservations, access restrictions, and preservation of stock during the logistics migration rehearsal.

final result: passed
