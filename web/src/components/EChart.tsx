import * as echarts from "echarts";
import { useEffect, useRef } from "react";

type Props = {
  option: echarts.EChartsOption;
  onClick?: (p: echarts.ECElementEvent) => void;
  className?: string;
  /** Replace the whole option instead of merging (needed when series change shape). */
  replace?: boolean;
};

/** Minimal ECharts binding: one instance per element, resized with its box. */
export function EChart({ option, onClick, className, replace = true }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);
  const click = useRef(onClick);
  click.current = onClick;

  useEffect(() => {
    const c = echarts.init(el.current!, undefined, { renderer: "canvas" });
    chart.current = c;
    c.on("click", (p) => click.current?.(p as echarts.ECElementEvent));
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current!);
    return () => {
      ro.disconnect();
      c.dispose();
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption({ backgroundColor: "transparent", animationDuration: 600, ...option }, { notMerge: replace });
  }, [option, replace]);

  return <div ref={el} className={className ?? "h-full w-full"} />;
}
