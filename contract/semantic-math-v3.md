# Semantic math scene v3

The companion JSON Schema describes input shape. Renderers also enforce the rules below. Plans are UTF-8 JSON (64 KiB maximum) with plain labels and narration utterances. A scene has one graph and five to eight beats over 90–120 integer seconds at exactly 30 fps.

## Graph and line

The domain is an ordered pair of x coordinates. Each expression is at most 64 nodes and eight levels deep, with a root at level one. Only the root may be piecewise. Its breakpoint is interior, the before branch applies to x < at, and the after branch applies at equality. The branches must match in value and first derivative at the breakpoint (relative tolerance 1e−8 with an absolute floor of 1e−8). All rendered values and slopes must be finite and have magnitude at most 1e6.

Use the usual arithmetic and analytic differentiation rules. The x node is the independent variable, even when its printed name is t. A smooth node with steepness k and input u returns [sigmoid(k(u−1/2))−sigmoid(−k/2)]/[1−2 sigmoid(−k/2)]. Differentiate analytically through its input. This is an affine-normalized logistic, without clamping outside [0,1]. Multiplication by a reciprocal expresses scaling or division by a constant.

At each frame P = (a,f(a)) and Q = (a+h,f(a+h)). A nonzero h is always a secant with slope (f(a+h)−f(a))/h, including when Q is visually close to P. A zero h means exact Q=P, no quotient evaluation, and the analytic tangent slope f′(a). At authored keyframes, a nonzero |h| is at least 0.0001. Consecutive nonzero h values cannot change sign. P, Q and any reference lie within the domain.

## Timeline

Beat zero starts and settles at frame 0. Each later beat starts strictly after the previous start and settles between its start and start+150 inclusive. The first 0–150 frames of a beat may interpolate a, h and camera from the preceding keyframe. Use cubic smoothstep u²(3−2u) for the interpolation weight. Interpolate a, h and camera centers linearly with that weight. Interpolate positive viewport width and height in log space. Return the authored targets exactly at settleFrame. Width and height are full extents in graph coordinates. At each target the camera contains P and Q, and in compare it also contains the reference.

Each beat owns [startFrame,nextStartFrame), using 30 × durationSeconds as the final exclusive end. The target display appears at settleFrame. During movement use the preceding display if compatible with the current geometry, and otherwise use points. Formula and geometry settle at least 12 frames before cueFrame. An utterance starts at cueFrame and must finish at least nine frames before the next beat. Leave enough room for actual speech. Optional plain captions are eligible from the cue until the end of its beat.

function displays the symbolic function identifier and curve. points adds P and Q. difference adds horizontal and vertical changes. secant adds the secant line and difference quotient. limit displays a nonzero secant and the limit expression. tangent displays the exact derivative and tangent. compare adds a second analytic tangent at the distinct reference coordinate. difference, secant and limit require h ≠ 0. tangent and compare require h = 0. reference appears only for compare.

A compiled frame supplies the frame index, active beat and cue, display mode, viewport, P, Q, signed h, line kind and slope, and optional reference point/slope. Keep curve, axes and point identities consistent through movement. Sample the graph within its authored domain. Render formula templates with a math typesetter and use plain text rendering for labels and optional captions.

## Comparison audio

A separately authored master WAV is mono, signed 16-bit integer PCM at 16–48 kHz. Time zero is video frame zero. Pad with silence around utterances at their specified cues and through the final frame. No executable content belongs in the plan. The WAV stays separate from the JSON and may be supplied to either local renderer. Renderers can also synthesize each utterance at its cue from the same plan.
