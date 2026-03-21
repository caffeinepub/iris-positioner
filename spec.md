# Iris Positioner - Ocular Prosthesis Tool

## Current State
New project, no existing code.

## Requested Changes (Diff)

### Add
- Interactive canvas tool for marking ocular landmarks
- Step-by-step workflow: (1) upload or use blank canvas, (2) mark medial canthus, lateral canthus, iris center on normal eye, (3) mark medial and lateral canthus on defect eye, (4) auto-calculate iris center position for defect eye
- Horizontal measurement line drawn across both eyes
- Visual markers for: medial canthus (MC), lateral canthus (LC), iris center (IC) on normal eye
- Proportional calculation: MC-to-IC / total_width and LC-to-IC / total_width
- Calculated iris position displayed on defect eye with a circle overlay
- Results panel showing measurements and proportions numerically
- Reset and redo capability
- Ability to upload a patient photo as canvas background

### Modify
N/A

### Remove
N/A

## Implementation Plan
1. Pure frontend app - no backend data persistence needed beyond session
2. Canvas component with click-to-place landmark points
3. State machine: steps 1-6 guiding user through marking sequence
4. Draw horizontal lines connecting MC to LC for both eyes
5. Calculate proportions from normal eye, apply to defect eye
6. Display results with labeled diagram and numeric table
7. Export/print result option
