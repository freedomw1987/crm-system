/**
 * ChartBlock — renders a single Chart.js chart from a JSON spec
 * embedded in a ```chart``` code fence by the LLM.
 *
 * Spec contract (taught to the model in packages/ai/src/prompts.ts):
 *
 *     {
 *       "type": "bar" | "line" | "pie" | "doughnut",
 *       "data": {
 *         "labels": ["Jan", "Feb", ...],
 *         "datasets": [
 *           { "label": "Revenue", "data": [10, 20, 30] }
 *         ]
 *       },
 *       "options": { ... }   // optional
 *     }
 *
 * Why a custom block: react-markdown's `components` map handles
 * inline HTML / custom nodes, but we want the *content* of a code
 * fence to control what we render. Easier to pre-split the source
 * (in MarkdownContent.tsx) and render <ChartBlock> directly.
 *
 * Failure mode: malformed JSON, unknown chart type, missing data —
 * we render a compact error card with the raw JSON so the user
 * still sees the numbers.
 */
import {
  Chart as ChartJS,
  BarController,
  LineController,
  PieController,
  DoughnutController,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Bar, Line, Pie, Doughnut } from 'react-chartjs-2';

// Register the controllers / elements / plugins we need. Chart.js
// v4 does not auto-register anything; you either call
// Chart.register(...) or use the tree-shakeable entry points. This
// explicit path keeps the bundle tight (unused scales don't get
// pulled in).
ChartJS.register(
  BarController,
  LineController,
  PieController,
  DoughnutController,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  ArcElement,
  Title,
  Tooltip,
  Legend,
  Filler,
);

type ChartType = 'bar' | 'line' | 'pie' | 'doughnut';

interface ChartSpec {
  type: ChartType;
  data: {
    labels: string[];
    datasets: Array<{
      label?: string;
      data: number[];
      backgroundColor?: string | string[];
      borderColor?: string;
      borderWidth?: number;
      fill?: boolean;
      tension?: number;
    }>;
  };
  options?: Record<string, unknown>;
}

/** Default palette — rotates so multi-dataset charts are readable. */
const DEFAULT_PALETTE = [
  'rgba(59, 130, 246, 0.7)',  // blue-500
  'rgba(16, 185, 129, 0.7)',  // emerald-500
  'rgba(245, 158, 11, 0.7)',  // amber-500
  'rgba(239, 68, 68, 0.7)',   // red-500
  'rgba(139, 92, 246, 0.7)',  // violet-500
  'rgba(14, 165, 233, 0.7)',  // sky-500
  'rgba(236, 72, 153, 0.7)',  // pink-500
  'rgba(34, 197, 94, 0.7)',   // green-500
];

function fillDefaults(spec: ChartSpec): ChartSpec {
  const datasets = spec.data.datasets.map((ds, i) => ({
    ...ds,
    backgroundColor:
      ds.backgroundColor ??
      (spec.type === 'pie' || spec.type === 'doughnut'
        ? DEFAULT_PALETTE
        : DEFAULT_PALETTE[i % DEFAULT_PALETTE.length]),
    borderColor: ds.borderColor ?? DEFAULT_PALETTE[i % DEFAULT_PALETTE.length],
    borderWidth: ds.borderWidth ?? (spec.type === 'line' ? 2 : 1),
  }));
  return { ...spec, data: { ...spec.data, datasets } };
}

interface ChartBlockProps {
  json: string;
}

export function ChartBlock({ json }: ChartBlockProps) {
  let spec: ChartSpec;
  try {
    spec = JSON.parse(json) as ChartSpec;
  } catch (err) {
    return (
      <div className="my-2 rounded border border-destructive/30 bg-destructive/5 p-2 text-xs">
        <div className="font-semibold text-destructive mb-1">Chart JSON parse error</div>
        <pre className="whitespace-pre-wrap break-all text-foreground/80">{json}</pre>
      </div>
    );
  }

  if (!spec.type || !spec.data || !Array.isArray(spec.data.datasets)) {
    return (
      <div className="my-2 rounded border border-amber-500/30 bg-amber-500/5 p-2 text-xs">
        <div className="font-semibold text-amber-700 dark:text-amber-400 mb-1">Incomplete chart spec</div>
        <pre className="whitespace-pre-wrap break-all">{json}</pre>
      </div>
    );
  }

  const filled = fillDefaults(spec);
  const options = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: filled.data.datasets.length > 1, position: 'bottom' as const },
    },
    ...(filled.options as object),
  };

  // Force a fixed-height container so Chart.js can compute the
  // canvas size. Responsive width comes from the parent.
  return (
    <div className="my-3 rounded border bg-card p-3 shadow-sm">
      <div className="h-64 w-full">
        <ChartRenderer type={filled.type} data={filled.data} options={options} />
      </div>
    </div>
  );
}

function ChartRenderer({
  type,
  data,
  options,
}: {
  type: ChartType;
  data: ChartSpec['data'];
  options: object;
}) {
  // react-chartjs-2 doesn't expose a single <Chart type="...">
  // component; we have to pick the right concrete component.
  switch (type) {
    case 'bar':
      return <Bar data={data} options={options} />;
    case 'line':
      return <Line data={data} options={options} />;
    case 'pie':
      return <Pie data={data} options={options} />;
    case 'doughnut':
      return <Doughnut data={data} options={options} />;
    default:
      // Defensive — should be caught above. Render an error.
      return (
        <div className="text-xs text-destructive">
          Unsupported chart type: {String(type)}
        </div>
      );
  }
}
