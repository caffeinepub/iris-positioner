# Iris Positioner

## Current State
Full iris positioning tool with canvas-based landmark marking, proportional calculation of iris center for defect eye, results panel, and basic print/export.

## Requested Changes (Diff)

### Add
- Printed jig feature: a printable physical reference template showing the defect eye's medial-to-lateral canthus line with the calculated iris center marked
- "Print Jig" button visible only when calculation is complete (step 7 / icD calculated)
- Jig renders as a clean, minimal print layout with: horizontal canthus line scaled to a user-selectable real-world width, crosshair at iris center, distance/ratio annotations, cut lines, and a usage instruction
- Optional input for real canthus-to-canthus distance in mm so the jig scales to actual size

### Modify
- Results panel: add jig controls (mm input + Print Jig button) below clinical recommendation

### Remove
- Nothing removed

## Implementation Plan
1. Add mm input field to ResultsPanel for real-world canthus width
2. Add PrintJig component that renders a canvas-based jig scaled to mm (or ratio-only fallback)
3. Add print CSS to hide everything except the jig when printing via jig print button
4. Wire Print Jig button to trigger window.print() with jig-only print styles
