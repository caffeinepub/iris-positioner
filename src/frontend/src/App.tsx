import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Circle,
  Eye,
  Printer,
  RotateCcw,
  Undo2,
  Upload,
  WifiOff,
  X,
} from "lucide-react";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";

// ─── Types ───────────────────────────────────────────────────────────────────

type Point = { x: number; y: number };

interface AppPoints {
  mcN: Point | null;
  lcN: Point | null;
  icN: Point | null;
  mcD: Point | null;
  lcD: Point | null;
  icD: Point | null;
}

interface AppState {
  step: number;
  normalEye: "left" | "right";
  points: AppPoints;
  bgImageDataUrl: string | null;
}

type Action =
  | { type: "SET_NORMAL_EYE"; payload: "left" | "right" }
  | { type: "ADVANCE_STEP" }
  | { type: "PLACE_POINT"; payload: { key: keyof AppPoints; point: Point } }
  | { type: "MOVE_POINT"; payload: { key: keyof AppPoints; point: Point } }
  | { type: "RESET" }
  | { type: "UNDO" }
  | { type: "SET_BG_IMAGE"; payload: string | null };

// ─── Constants ─────────────────────────────────────────────────────────────

const STEPS = [
  { id: 1, label: "Setup", desc: "Configure eye sides & upload photo" },
  {
    id: 2,
    label: "Medial Canthus (Normal)",
    desc: "Click inner corner of normal eye",
  },
  {
    id: 3,
    label: "Lateral Canthus (Normal)",
    desc: "Click outer corner of normal eye",
  },
  {
    id: 4,
    label: "Iris Center (Normal)",
    desc: "Click iris center of normal eye",
  },
  {
    id: 5,
    label: "Medial Canthus (Defect)",
    desc: "Click inner corner of defect eye",
  },
  {
    id: 6,
    label: "Lateral Canthus (Defect)",
    desc: "Click outer corner of defect eye",
  },
];

const STEP_POINT_MAP: Record<number, keyof AppPoints> = {
  2: "mcN",
  3: "lcN",
  4: "icN",
  5: "mcD",
  6: "lcD",
};

// Canvas literal colors (CSS vars cannot be used in Canvas2D API)
const C_NORMAL = "#ef4444";
const C_DEFECT = "#f97316";
const C_IRIS_N = "#3b82f6";
const C_IRIS_D = "#0d9488";
const C_LINE_N = "rgba(239,68,68,0.7)";
const C_LINE_D = "rgba(249,115,22,0.7)";
const C_LABEL = "#1e293b";

// Physical print constants
const MM_TO_PX = 3.7795; // 1mm at 96dpi

// ─── Pure helpers ───────────────────────────────────────────────────────────

function dist(a: Point, b: Point) {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

function calcIrisDefect(pts: AppPoints): Point | null {
  const { mcN, lcN, icN, mcD, lcD } = pts;
  if (!mcN || !lcN || !icN || !mcD || !lcD) return null;
  const totalN = dist(mcN, lcN);
  if (totalN === 0) return null;
  const ratio = dist(mcN, icN) / totalN;
  return {
    x: mcD.x + ratio * (lcD.x - mcD.x),
    y: mcD.y + ratio * (lcD.y - mcD.y),
  };
}

function snapToLine(p: Point, a: Point, b: Point): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return a;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy);
  const tc = Math.max(0, Math.min(1, t));
  return { x: a.x + tc * dx, y: a.y + tc * dy };
}

function withCalcIcD(pts: AppPoints): AppPoints {
  return { ...pts, icD: calcIrisDefect(pts) };
}

// ─── Canvas draw helpers (module-level so TypeScript can type ctx correctly) ──

function canvasDrawLine(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  color: string,
) {
  ctx.save();
  ctx.setLineDash([6, 4]);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

function canvasDrawDot(
  ctx: CanvasRenderingContext2D,
  p: Point,
  label: string,
  fill: string,
  r = 3,
) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "white";
  ctx.stroke();

  ctx.font = "bold 11px 'Plus Jakarta Sans', system-ui, sans-serif";
  const tw = ctx.measureText(label).width;
  const tx = p.x + r + 4;
  const ty = p.y - r - 4;
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fillRect(tx - 2, ty - 12, tw + 4, 15);
  ctx.fillStyle = C_LABEL;
  ctx.fillText(label, tx, ty);
}

// ─── Reducer ─────────────────────────────────────────────────────────────────

const initialState: AppState = {
  step: 1,
  normalEye: "left",
  points: { mcN: null, lcN: null, icN: null, mcD: null, lcD: null, icD: null },
  bgImageDataUrl: null,
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "SET_NORMAL_EYE":
      return { ...state, normalEye: action.payload };
    case "ADVANCE_STEP":
      return { ...state, step: Math.min(state.step + 1, 7) };
    case "PLACE_POINT": {
      const newPoints = withCalcIcD({
        ...state.points,
        [action.payload.key]: action.payload.point,
      });
      return { ...state, points: newPoints, step: Math.min(state.step + 1, 7) };
    }
    case "MOVE_POINT": {
      const newPoints = withCalcIcD({
        ...state.points,
        [action.payload.key]: action.payload.point,
      });
      return { ...state, points: newPoints };
    }
    case "RESET":
      return { ...initialState, bgImageDataUrl: state.bgImageDataUrl };
    case "UNDO": {
      if (state.step <= 2) return { ...state, step: 2 };
      const prevStep = state.step - 1;
      const prevKey = STEP_POINT_MAP[prevStep];
      const clearedPoints = prevKey
        ? withCalcIcD({ ...state.points, [prevKey]: null })
        : state.points;
      return { ...state, step: prevStep, points: clearedPoints };
    }
    case "SET_BG_IMAGE":
      return { ...state, bgImageDataUrl: action.payload };
    default:
      return state;
  }
}

// ─── Print Jig Overlay ────────────────────────────────────────────────────────

function PrintJigOverlay({
  ratioMcIc,
  jigMm,
  onClose,
}: {
  ratioMcIc: number;
  jigMm: string;
  onClose: () => void;
}) {
  const mmVal = Number.parseFloat(jigMm);
  const hasScale = !Number.isNaN(mmVal) && mmVal > 0;
  const lineWidthPx = hasScale ? mmVal * MM_TO_PX : 280;
  const irisFromMcMm = hasScale ? (ratioMcIc / 100) * mmVal : null;
  const crosshairX = ratioMcIc / 100;
  // Crosshair vertical arm: 20mm tall
  const armPx = 20 * MM_TO_PX;
  // Circle diameter: 4mm
  const circleR = (4 * MM_TO_PX) / 2;
  // Standard iris diameter: 11.7mm
  const irisCircleR = (11.7 * MM_TO_PX) / 2;

  // Inject print styles
  useEffect(() => {
    const style = document.createElement("style");
    style.id = "jig-print-style";
    style.textContent = `
      @media print {
        body * { visibility: hidden !important; }
        #jig-print-area, #jig-print-area * { visibility: visible !important; }
        #jig-print-area { position: fixed; top: 0; left: 0; width: 100%; }
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.getElementById("jig-print-style")?.remove();
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 bg-white flex flex-col items-center justify-center"
      data-ocid="jig.modal"
    >
      {/* Close button */}
      <button
        type="button"
        onClick={onClose}
        className="print:hidden absolute top-4 right-4 w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center transition-colors"
        data-ocid="jig.close_button"
        aria-label="Close jig"
      >
        <X className="w-4 h-4 text-gray-600" />
      </button>

      {/* Print button */}
      <div className="print:hidden mb-6 flex items-center gap-3">
        <h2 className="text-lg font-bold text-gray-800">
          Printable Jig Preview
        </h2>
        <button
          type="button"
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 rounded-md bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 transition-colors"
          data-ocid="jig.primary_button"
        >
          <Printer className="w-4 h-4" /> Print Jig
        </button>
      </div>

      {/* Jig print area */}
      <div
        id="jig-print-area"
        className="flex flex-col items-center"
        style={{ fontFamily: "'Arial', sans-serif" }}
      >
        {/* Title */}
        <div className="text-center mb-6">
          <h1
            style={{
              fontSize: "16px",
              fontWeight: "bold",
              color: "#000",
              marginBottom: "4px",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}
          >
            Iris Positioning Jig — Defect Eye
          </h1>
          <p style={{ fontSize: "11px", color: "#444", margin: 0 }}>
            Align MC and LC marks to medial and lateral canthus
          </p>
        </div>

        {/* Cut-out border container */}
        <div
          style={{
            border: "2px dashed #222",
            padding: "28px 36px",
            background: "#fff",
            position: "relative",
            display: "inline-block",
          }}
        >
          {/* Corner cut marks */}
          {(
            [
              { top: -1, left: -1, id: "tl" },
              { top: -1, right: -1, id: "tr" },
              { bottom: -1, left: -1, id: "bl" },
              { bottom: -1, right: -1, id: "br" },
            ] as Array<{
              id: string;
              top?: number;
              right?: number;
              bottom?: number;
              left?: number;
            }>
          ).map((pos) => (
            <div
              key={pos.id}
              style={{
                position: "absolute",
                width: "8px",
                height: "8px",
                borderTop: pos.top !== undefined ? "2px solid #222" : "none",
                borderBottom:
                  pos.bottom !== undefined ? "2px solid #222" : "none",
                borderLeft: pos.left !== undefined ? "2px solid #222" : "none",
                borderRight:
                  pos.right !== undefined ? "2px solid #222" : "none",
                top: pos.top,
                right: pos.right,
                bottom: pos.bottom,
                left: pos.left,
              }}
            />
          ))}

          {/* Jig body */}
          <div
            style={{
              width: `${lineWidthPx}px`,
              position: "relative",
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
            }}
          >
            {/* Labels row */}
            <div
              style={{
                width: "100%",
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "6px",
              }}
            >
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: "bold",
                  color: "#000",
                }}
              >
                MC
              </span>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: "bold",
                  color: "#000",
                }}
              >
                LC
              </span>
            </div>

            {/* Crosshair + horizontal line area */}
            <div
              style={{
                width: "100%",
                position: "relative",
                height: `${Math.max(armPx + 4, irisCircleR * 2 + 8)}px`,
              }}
            >
              {/* Horizontal canthus line — MC to LC */}
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: 0,
                  width: "100%",
                  height: "3px",
                  background: "#1a56db",
                  transform: "translateY(-50%)",
                }}
              />

              {/* MC tick */}
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: 0,
                  width: "3px",
                  height: "20px",
                  background: "#1a56db",
                  transform: "translate(-50%, -50%)",
                }}
              />

              {/* LC tick */}
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  right: 0,
                  width: "3px",
                  height: "20px",
                  background: "#1a56db",
                  transform: "translate(50%, -50%)",
                }}
              />

              {/* Vertical crosshair arm */}
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: `${crosshairX * 100}%`,
                  width: "1px",
                  height: `${armPx}px`,
                  background: "#000",
                  borderLeft: "1px dashed #000",
                  transform: "translate(-50%, -50%)",
                }}
              />

              {/* Iris center circle */}
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: `${crosshairX * 100}%`,
                  width: `${circleR * 2}px`,
                  height: `${circleR * 2}px`,
                  border: "1.5px solid #000",
                  borderRadius: "50%",
                  background: "transparent",
                  transform: "translate(-50%, -50%)",
                  zIndex: 2,
                }}
              />

              {/* CSS crosshair inside circle — horizontal */}
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: `${crosshairX * 100}%`,
                  width: `${circleR * 1.6}px`,
                  height: "1px",
                  background: "#000",
                  transform: "translate(-50%, -50%)",
                  zIndex: 3,
                }}
              />

              {/* CSS crosshair inside circle — vertical */}
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: `${crosshairX * 100}%`,
                  width: "1px",
                  height: `${circleR * 1.6}px`,
                  background: "#000",
                  transform: "translate(-50%, -50%)",
                  zIndex: 3,
                }}
              />
              {/* Iris diameter circle (standard 11.7 mm) */}
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: `${crosshairX * 100}%`,
                  width: `${irisCircleR * 2}px`,
                  height: `${irisCircleR * 2}px`,
                  border: "1.5px dashed #444",
                  borderRadius: "50%",
                  background: "transparent",
                  transform: "translate(-50%, -50%)",
                  zIndex: 1,
                  boxSizing: "border-box",
                }}
              />
            </div>

            {/* Measurements below */}
            <div
              style={{
                width: "100%",
                marginTop: "10px",
                borderTop: "1px solid #ddd",
                paddingTop: "8px",
              }}
            >
              {irisFromMcMm !== null ? (
                <p
                  style={{
                    fontSize: "11px",
                    color: "#222",
                    margin: "0 0 3px 0",
                    textAlign: "center",
                  }}
                >
                  Iris center: <strong>{irisFromMcMm.toFixed(1)} mm</strong>{" "}
                  from MC
                </p>
              ) : (
                <p
                  style={{
                    fontSize: "10px",
                    color: "#888",
                    margin: "0 0 3px 0",
                    textAlign: "center",
                    fontStyle: "italic",
                  }}
                >
                  Scale not set — enter actual canthus width for mm values
                </p>
              )}
              <p
                style={{
                  fontSize: "11px",
                  color: "#444",
                  margin: 0,
                  textAlign: "center",
                }}
              >
                Position: <strong>{ratioMcIc.toFixed(1)}%</strong> from MC
              </p>
              {hasScale && (
                <p
                  style={{
                    fontSize: "10px",
                    color: "#666",
                    margin: "3px 0 0",
                    textAlign: "center",
                  }}
                >
                  Canthus span: <strong>{mmVal} mm</strong>
                </p>
              )}
              <p
                style={{
                  fontSize: "10px",
                  color: "#555",
                  margin: "3px 0 0",
                  textAlign: "center",
                }}
              >
                Iris diameter circle: <strong>11.7 mm</strong> (dashed)
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <p
          style={{
            marginTop: "16px",
            fontSize: "9px",
            color: "#aaa",
            letterSpacing: "0.04em",
          }}
        >
          Generated by Iris Positioner
        </p>
      </div>
    </div>
  );
}

// ─── Results Panel ────────────────────────────────────────────────────────────

function ResultsPanel({
  points,
  normalEye,
  jigMm,
  onJigMmChange,
  onPrintJig,
}: {
  points: AppPoints;
  normalEye: "left" | "right";
  jigMm: string;
  onJigMmChange: (v: string) => void;
  onPrintJig: () => void;
}) {
  const { mcN, lcN, icN, mcD, lcD, icD } = points;
  if (!mcN || !lcN || !icN || !mcD || !lcD || !icD) return null;

  const totalN = dist(mcN, lcN);
  const mcToIcN = dist(mcN, icN);
  const icToLcN = dist(icN, lcN);
  const ratioMcIc = totalN > 0 ? (mcToIcN / totalN) * 100 : 0;
  const totalD = dist(mcD, lcD);
  const mcToIcD = dist(mcD, icD);
  const ratioD = totalD > 0 ? (mcToIcD / totalD) * 100 : 0;
  const defectEye = normalEye === "left" ? "right" : "left";

  return (
    <div className="animate-fade-in" data-ocid="results.panel">
      <Card className="border border-primary/20">
        <CardHeader
          className="pb-3 rounded-t-lg"
          style={{ background: "oklch(var(--primary) / 0.05)" }}
        >
          <CardTitle className="text-sm font-semibold text-primary flex items-center gap-2">
            <Activity className="w-4 h-4" />
            Measurement Results
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          {/* Normal eye */}
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Normal Eye ({normalEye})
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <span className="text-muted-foreground">MC &#8594; Iris</span>
              <span className="font-medium tabular-nums">
                {mcToIcN.toFixed(1)} px
              </span>
              <span className="text-muted-foreground">Iris &#8594; LC</span>
              <span className="font-medium tabular-nums">
                {icToLcN.toFixed(1)} px
              </span>
              <span className="text-muted-foreground">Total width</span>
              <span className="font-medium tabular-nums">
                {totalN.toFixed(1)} px
              </span>
              <span className="text-muted-foreground">MC:IC ratio</span>
              <span className="font-medium tabular-nums text-blue-600">
                {ratioMcIc.toFixed(1)}%
              </span>
              <span className="text-muted-foreground">IC:LC ratio</span>
              <span className="font-medium tabular-nums text-blue-600">
                {(100 - ratioMcIc).toFixed(1)}%
              </span>
            </div>
          </div>

          <Separator />

          {/* Defect eye */}
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Defect Eye ({defectEye})
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
              <span className="text-muted-foreground">Total width</span>
              <span className="font-medium tabular-nums">
                {totalD.toFixed(1)} px
              </span>
              <span className="text-muted-foreground">Iris from MC</span>
              <span className="font-medium tabular-nums">
                {mcToIcD.toFixed(1)} px
              </span>
              <span className="text-muted-foreground">Position %</span>
              <span
                className="font-medium tabular-nums"
                style={{ color: C_IRIS_D }}
              >
                {ratioD.toFixed(1)}%
              </span>
            </div>
          </div>

          <Separator />

          <div
            className="rounded-md p-3 border"
            style={{
              background: "oklch(var(--primary) / 0.06)",
              borderColor: "oklch(var(--primary) / 0.15)",
            }}
          >
            <p className="text-[11px] text-muted-foreground mb-1 font-medium uppercase tracking-wider">
              Clinical Recommendation
            </p>
            <p className="text-sm font-semibold text-primary leading-snug">
              Place iris center at{" "}
              <span className="text-base font-bold">
                {mcToIcD.toFixed(1)} px
              </span>{" "}
              ({ratioD.toFixed(1)}%) from the medial canthus of the prosthesis
            </p>
          </div>

          <Separator />

          {/* Printed Jig section */}
          <div>
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Printed Jig
            </p>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label
                  htmlFor="jig-mm-input"
                  className="text-xs font-medium text-foreground"
                >
                  Actual canthus width (mm)
                </Label>
                <Input
                  id="jig-mm-input"
                  type="number"
                  min="1"
                  max="60"
                  step="0.5"
                  placeholder="e.g. 28"
                  value={jigMm}
                  onChange={(e) => onJigMmChange(e.target.value)}
                  className="h-8 text-xs"
                  data-ocid="jig.input"
                />
                <p className="text-[10px] text-muted-foreground">
                  Measure the real canthus span with calipers for accurate
                  scaling.
                </p>
              </div>
              <Button
                onClick={onPrintJig}
                className="w-full h-9 text-xs gap-2 text-white"
                style={{ background: "oklch(var(--primary))" }}
                data-ocid="jig.open_modal_button"
              >
                <Printer className="w-3.5 h-3.5" />
                Print Jig
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [showJig, setShowJig] = useState(false);
  const [jigMm, setJigMm] = useState("");
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const bgImageRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{
    key: keyof AppPoints | null;
    offsetX: number;
    offsetY: number;
  }>({ key: null, offsetX: 0, offsetY: 0 });

  const { step, normalEye, points, bgImageDataUrl } = state;
  const defectEye = normalEye === "left" ? "right" : "left";
  const isPlacingMode = step >= 2 && step <= 6;

  // Offline detection
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Compute ratio for jig
  const ratioMcIc = (() => {
    const { mcN, lcN, icN } = points;
    if (!mcN || !lcN || !icN) return 50;
    const totalN = dist(mcN, lcN);
    return totalN > 0 ? (dist(mcN, icN) / totalN) * 100 : 50;
  })();

  // Load background image
  useEffect(() => {
    if (!bgImageDataUrl) {
      bgImageRef.current = null;
      return;
    }
    const img = new Image();
    img.onload = () => {
      bgImageRef.current = img;
      drawCanvas();
    };
    img.src = bgImageDataUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bgImageDataUrl]);

  // ─── Canvas draw ────────────────────────────────────────────────────────────

  const drawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background
    if (bgImageRef.current) {
      ctx.drawImage(bgImageRef.current, 0, 0, canvas.width, canvas.height);
    } else {
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "#e2e8f0";
      ctx.lineWidth = 1;
      const gs = 40;
      for (let x = 0; x <= canvas.width; x += gs) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y <= canvas.height; y += gs) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }
      ctx.font = "14px 'Plus Jakarta Sans', system-ui, sans-serif";
      ctx.fillStyle = "#94a3b8";
      ctx.textAlign = "center";
      ctx.fillText(
        "Both eyes should be visible in this area",
        canvas.width / 2,
        canvas.height / 2,
      );
      ctx.fillText(
        "Upload a patient photo or proceed with blank canvas",
        canvas.width / 2,
        canvas.height / 2 + 22,
      );
      ctx.textAlign = "left";
    }

    const { mcN, lcN, icN, mcD, lcD, icD } = points;

    if (mcN && lcN) canvasDrawLine(ctx, mcN, lcN, C_LINE_N);
    if (mcD && lcD) canvasDrawLine(ctx, mcD, lcD, C_LINE_D);

    if (mcN) canvasDrawDot(ctx, mcN, "MC-N", C_NORMAL);
    if (lcN) canvasDrawDot(ctx, lcN, "LC-N", C_NORMAL);
    if (icN) canvasDrawDot(ctx, icN, "IC-N", C_IRIS_N);
    if (mcD) canvasDrawDot(ctx, mcD, "MC-D", C_DEFECT);
    if (lcD) canvasDrawDot(ctx, lcD, "LC-D", C_DEFECT);

    if (icD) {
      ctx.beginPath();
      ctx.arc(icD.x, icD.y, 20, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(13,148,136,0.12)";
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = C_IRIS_D;
      ctx.setLineDash([]);
      ctx.stroke();
      canvasDrawDot(ctx, icD, "IC-D", C_IRIS_D, 3);
    }

    // Proportion annotation
    if (mcN && lcN && icN) {
      const totalN = dist(mcN, lcN);
      const ratio = totalN > 0 ? (dist(mcN, icN) / totalN) * 100 : 0;
      const midX = (mcN.x + lcN.x) / 2;
      const midY = Math.min(mcN.y, lcN.y) - 18;
      const text = `MC\u2192IC: ${ratio.toFixed(1)}%  |  IC\u2192LC: ${(100 - ratio).toFixed(1)}%`;
      ctx.font = "11px 'Plus Jakarta Sans', system-ui, sans-serif";
      const tw = ctx.measureText(text).width;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillRect(midX - tw / 2 - 4, midY - 13, tw + 8, 16);
      ctx.fillStyle = C_IRIS_N;
      ctx.textAlign = "center";
      ctx.fillText(text, midX, midY);
      ctx.textAlign = "left";
    }
  }, [points]);

  useEffect(() => {
    drawCanvas();
  }, [drawCanvas]);

  // ─── Canvas resize ───────────────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ro = new ResizeObserver(() => {
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
      drawCanvas();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [drawCanvas]);

  // ─── Canvas interactions ─────────────────────────────────────────────────────

  function getPointNear(x: number, y: number): keyof AppPoints | null {
    const check: Array<[keyof AppPoints, Point | null]> = [
      ["mcN", points.mcN],
      ["lcN", points.lcN],
      ["icN", points.icN],
      ["mcD", points.mcD],
      ["lcD", points.lcD],
    ];
    for (const [key, p] of check) {
      if (p && dist(p, { x, y }) < 14) return key;
    }
    return null;
  }

  function getCanvasXY(e: React.MouseEvent<HTMLCanvasElement>): Point {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * (canvas.width / rect.width),
      y: (e.clientY - rect.top) * (canvas.height / rect.height),
    };
  }

  function handleMouseDown(e: React.MouseEvent<HTMLCanvasElement>) {
    const { x, y } = getCanvasXY(e);
    const nearby = getPointNear(x, y);
    if (nearby) {
      const p = points[nearby]!;
      dragRef.current = { key: nearby, offsetX: x - p.x, offsetY: y - p.y };
      return;
    }
    if (!isPlacingMode) return;
    const pointKey = STEP_POINT_MAP[step];
    if (!pointKey) return;
    let placed: Point = { x, y };
    if (step === 4 && points.mcN && points.lcN) {
      placed = snapToLine(placed, points.mcN, points.lcN);
    }
    dispatch({
      type: "PLACE_POINT",
      payload: { key: pointKey, point: placed },
    });
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const { x, y } = getCanvasXY(e);
    const nearby = getPointNear(x, y);
    canvas.style.cursor = nearby
      ? "grab"
      : isPlacingMode
        ? "crosshair"
        : "default";
    if (!dragRef.current.key) return;
    const key = dragRef.current.key;
    let np: Point = {
      x: x - dragRef.current.offsetX,
      y: y - dragRef.current.offsetY,
    };
    if (key === "icN" && points.mcN && points.lcN) {
      np = snapToLine(np, points.mcN, points.lcN);
    }
    dispatch({ type: "MOVE_POINT", payload: { key, point: np } });
  }

  function handleMouseUp() {
    dragRef.current = { key: null, offsetX: 0, offsetY: 0 };
  }

  // ─── File upload ─────────────────────────────────────────────────────────────

  function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      dispatch({ type: "SET_BG_IMAGE", payload: ev.target?.result as string });
    };
    reader.readAsDataURL(file);
  }

  const stepComplete = (s: number) => {
    if (s === 1) return step > 1;
    const key = STEP_POINT_MAP[s];
    return key ? !!points[key] : false;
  };

  const currentInstruction = () => {
    if (step === 1) return 'Configure setup, then click "Begin Marking".';
    if (step === 2)
      return `Click the MEDIAL CANTHUS (inner corner) of the NORMAL eye (${normalEye}).`;
    if (step === 3)
      return `Click the LATERAL CANTHUS (outer corner) of the NORMAL eye (${normalEye}).`;
    if (step === 4)
      return `Click the IRIS CENTER of the NORMAL eye (${normalEye}). It snaps to the canthus line.`;
    if (step === 5)
      return `Click the MEDIAL CANTHUS (inner corner) of the DEFECT eye (${defectEye}).`;
    if (step === 6)
      return `Click the LATERAL CANTHUS (outer corner) of the DEFECT eye (${defectEye}).`;
    return "All points placed. Iris position calculated automatically.";
  };

  return (
    <div
      className="min-h-screen flex flex-col bg-background"
      style={{ fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif" }}
    >
      {/* Header */}
      <header className="bg-white border-b border-border shadow-xs print:hidden">
        <div className="px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center"
              style={{ background: "oklch(var(--primary))" }}
            >
              <Eye className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-[15px] font-bold text-foreground leading-tight tracking-tight">
                Iris Positioner
              </h1>
              <p className="text-[11px] text-muted-foreground leading-tight">
                Ocular Prosthesis Planning Tool
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => dispatch({ type: "UNDO" })}
              disabled={step <= 1}
              data-ocid="app.undo_button"
              className="gap-1.5 text-xs h-8"
            >
              <Undo2 className="w-3.5 h-3.5" /> Undo
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => dispatch({ type: "RESET" })}
              data-ocid="app.delete_button"
              className="gap-1.5 text-xs h-8 text-destructive border-destructive/40 hover:bg-destructive/5"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Reset
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => window.print()}
              disabled={!points.icD}
              data-ocid="app.primary_button"
              className="gap-1.5 text-xs h-8 text-white"
              style={{ background: "oklch(var(--primary))" }}
            >
              <Printer className="w-3.5 h-3.5" /> Export
            </Button>
          </div>
        </div>
      </header>

      {/* Offline banner */}
      {isOffline && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-1.5 flex items-center justify-center gap-2 text-xs text-amber-700 font-medium print:hidden">
          <WifiOff className="w-3.5 h-3.5" />
          You are offline — the app is running from cache
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <aside className="w-72 bg-sidebar border-r border-sidebar-border flex flex-col shrink-0 print:hidden">
          <div className="p-4 flex-1 overflow-y-auto">
            <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">
              Workflow Steps
            </p>
            <nav className="space-y-1" data-ocid="steps.list">
              {STEPS.map((s, i) => {
                const done = stepComplete(s.id);
                const active = step === s.id;
                return (
                  <div
                    key={s.id}
                    data-ocid={`steps.item.${i + 1}`}
                    className={cn(
                      "flex items-start gap-3 p-2.5 rounded-md transition-all",
                      active && "border",
                      !active && done && "opacity-60",
                      !active && !done && step < s.id && "opacity-35",
                    )}
                    style={
                      active
                        ? {
                            background: "oklch(var(--primary) / 0.08)",
                            borderColor: "oklch(var(--primary) / 0.2)",
                          }
                        : {}
                    }
                  >
                    <div className="mt-0.5 shrink-0">
                      {done ? (
                        <CheckCircle2
                          className="w-4 h-4"
                          style={{ color: "oklch(var(--primary))" }}
                        />
                      ) : active ? (
                        <div
                          className="w-4 h-4 rounded-full border-2 flex items-center justify-center"
                          style={{ borderColor: "oklch(var(--primary))" }}
                        >
                          <div
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ background: "oklch(var(--primary))" }}
                          />
                        </div>
                      ) : (
                        <Circle className="w-4 h-4 text-muted-foreground/40" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-foreground">
                          {s.label}
                        </span>
                        {active && (
                          <Badge
                            className="text-[9px] px-1.5 py-0 h-4 text-white"
                            style={{ background: "oklch(var(--primary))" }}
                          >
                            Active
                          </Badge>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
                        {s.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
              {step === 7 && (
                <div
                  className="flex items-center gap-2 p-2.5 rounded-md border"
                  style={{
                    background: "oklch(var(--primary) / 0.08)",
                    borderColor: "oklch(var(--primary) / 0.2)",
                  }}
                >
                  <CheckCircle2
                    className="w-4 h-4 shrink-0"
                    style={{ color: "oklch(var(--primary))" }}
                  />
                  <span
                    className="text-xs font-semibold"
                    style={{ color: "oklch(var(--primary))" }}
                  >
                    Calculation Complete
                  </span>
                </div>
              )}
            </nav>

            <Separator className="my-4" />

            {step === 1 && (
              <div className="space-y-4 animate-fade-in">
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">
                    Normal Eye
                  </Label>
                  <Select
                    value={normalEye}
                    onValueChange={(v) =>
                      dispatch({
                        type: "SET_NORMAL_EYE",
                        payload: v as "left" | "right",
                      })
                    }
                  >
                    <SelectTrigger
                      data-ocid="setup.select"
                      className="h-8 text-xs"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="left">Left Eye</SelectItem>
                      <SelectItem value="right">Right Eye</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">
                    Defect Eye
                  </Label>
                  <div className="h-8 px-3 rounded-md border border-border bg-muted flex items-center">
                    <span className="text-xs text-muted-foreground capitalize">
                      {defectEye} Eye (auto-set)
                    </span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-foreground">
                    Patient Photo{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional)
                    </span>
                  </Label>
                  <label
                    className="flex items-center gap-2 h-8 px-3 rounded-md border border-dashed border-border bg-muted/50 cursor-pointer hover:bg-accent transition-colors text-xs text-muted-foreground"
                    data-ocid="setup.upload_button"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    Upload photo
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={handleFileUpload}
                    />
                  </label>
                  {bgImageDataUrl && (
                    <p
                      className="text-xs flex items-center gap-1"
                      style={{ color: "oklch(var(--primary))" }}
                    >
                      <CheckCircle2 className="w-3 h-3" /> Photo loaded
                    </p>
                  )}
                </div>
                <Button
                  className="w-full h-8 text-xs gap-1.5 text-white"
                  style={{ background: "oklch(var(--primary))" }}
                  onClick={() => dispatch({ type: "ADVANCE_STEP" })}
                  data-ocid="setup.primary_button"
                >
                  Begin Marking <ArrowRight className="w-3.5 h-3.5" />
                </Button>
              </div>
            )}

            {step >= 2 && (
              <div className="mt-2 space-y-3 animate-fade-in">
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                    Instruction
                  </p>
                  <div
                    className="rounded-md p-3 border"
                    style={{
                      background: "oklch(var(--accent))",
                      borderColor: "oklch(var(--primary) / 0.12)",
                    }}
                  >
                    <p className="text-xs text-foreground leading-relaxed">
                      {currentInstruction()}
                    </p>
                  </div>
                </div>
                {step > 2 && (
                  <p className="text-[11px] text-muted-foreground">
                    Tip: Drag any placed point to fine-tune its position.
                  </p>
                )}
                {points.mcN && points.lcN && points.icN && (
                  <div className="rounded-md bg-blue-50 border border-blue-100 p-2.5">
                    <p className="text-xs font-semibold text-blue-700 mb-1">
                      Normal Eye Proportions
                    </p>
                    <div className="text-xs text-blue-600 space-y-0.5">
                      <p>
                        MC &#8594; IC:{" "}
                        {(
                          (dist(points.mcN, points.icN) /
                            dist(points.mcN, points.lcN)) *
                          100
                        ).toFixed(1)}
                        %
                      </p>
                      <p>
                        IC &#8594; LC:{" "}
                        {(
                          (dist(points.icN, points.lcN) /
                            dist(points.mcN, points.lcN)) *
                          100
                        ).toFixed(1)}
                        %
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="p-4 border-t border-sidebar-border">
            <p className="text-[11px] text-muted-foreground text-center">
              &copy; {new Date().getFullYear()}. Built with &hearts; using{" "}
              <a
                href={`https://caffeine.ai?utm_source=caffeine-footer&utm_medium=referral&utm_content=${encodeURIComponent(window.location.hostname)}`}
                className="hover:underline"
                style={{ color: "oklch(var(--primary))" }}
                target="_blank"
                rel="noreferrer"
              >
                caffeine.ai
              </a>
            </p>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <div
            ref={containerRef}
            className="flex-1 relative"
            style={{ minHeight: 420 }}
          >
            <canvas
              ref={canvasRef}
              className="absolute inset-0 w-full h-full"
              style={{ touchAction: "none" }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              data-ocid="canvas_target"
            />

            {step >= 2 && step <= 6 && (
              <div className="absolute top-3 left-3 pointer-events-none">
                <Badge
                  className="text-xs text-white shadow-sm"
                  style={{ background: "oklch(var(--primary))" }}
                >
                  Step {step} of 6 &mdash; {STEPS[step - 1].label}
                </Badge>
              </div>
            )}
            {step === 7 && (
              <div className="absolute top-3 left-3 pointer-events-none">
                <Badge className="text-xs bg-emerald-600 text-white shadow-sm">
                  &#10003; Calculation Complete
                </Badge>
              </div>
            )}

            {(points.mcN || points.mcD) && (
              <div className="absolute bottom-3 right-3 bg-white/90 backdrop-blur-sm border border-border rounded-lg p-2.5 text-[11px] space-y-1 shadow-xs">
                {points.mcN && (
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ background: C_NORMAL }}
                    />
                    <span className="text-muted-foreground">
                      Normal eye landmarks
                    </span>
                  </div>
                )}
                {points.icN && (
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ background: C_IRIS_N }}
                    />
                    <span className="text-muted-foreground">
                      Normal iris center
                    </span>
                  </div>
                )}
                {points.mcD && (
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ background: C_DEFECT }}
                    />
                    <span className="text-muted-foreground">
                      Defect eye landmarks
                    </span>
                  </div>
                )}
                {points.icD && (
                  <div className="flex items-center gap-2">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ background: C_IRIS_D }}
                    />
                    <span className="font-semibold" style={{ color: C_IRIS_D }}>
                      Calculated iris position
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>

          {points.icD && (
            <div className="border-t border-border bg-white p-4 print:block overflow-y-auto max-h-72">
              <ResultsPanel
                points={points}
                normalEye={normalEye}
                jigMm={jigMm}
                onJigMmChange={setJigMm}
                onPrintJig={() => setShowJig(true)}
              />
            </div>
          )}
        </main>
      </div>

      {/* Print Jig Overlay */}
      {showJig && (
        <PrintJigOverlay
          ratioMcIc={ratioMcIc}
          jigMm={jigMm}
          onClose={() => setShowJig(false)}
        />
      )}
    </div>
  );
}
