import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  CrosshairMode,
  CandlestickSeries,
  HistogramSeries,
} from "lightweight-charts";
import type { IChartApi, ISeriesApi } from "lightweight-charts";
import { useTheme } from "../context/ThemeContext";

interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

interface Props {
  data: Bar[];
}

export default function CandlestickChart({ data }: Props) {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candleRef = useRef<ISeriesApi<any> | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const volumeRef = useRef<ISeriesApi<any> | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // Pull theme colors from CSS variables so the chart matches dark/light mode
    const rootStyle = getComputedStyle(document.documentElement);
    const rgbVar = (name: string, alpha = 1) => {
      const v = rootStyle.getPropertyValue(name).trim();
      return v ? `rgba(${v.split(/\s+/).join(",")}, ${alpha})` : "transparent";
    };
    const isLight = document.documentElement.getAttribute("data-theme") === "light";
    const gridColor = isLight ? "rgba(15, 23, 42, 0.08)" : "rgba(255, 255, 255, 0.06)";
    const borderColor = isLight ? "rgba(15, 23, 42, 0.15)" : "rgba(255, 255, 255, 0.1)";

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight || 400,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: rgbVar("--fg-muted"),
        fontFamily: "Inter, -apple-system, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: rgbVar("--accent", 0.33), labelBackgroundColor: rgbVar("--accent") },
        horzLine: { color: rgbVar("--accent", 0.33), labelBackgroundColor: rgbVar("--accent") },
      },
      rightPriceScale: { borderColor },
      timeScale: {
        borderColor,
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: true,
      handleScale: true,
    });

    chartRef.current = chart;

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#1ed688",
      downColor: "#ff5c5c",
      borderUpColor: "#1ed688",
      borderDownColor: "#ff5c5c",
      wickUpColor: "#1ed68899",
      wickDownColor: "#ff5c5c99",
    });
    candleRef.current = candleSeries;

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: "#7c5cfc33",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeRef.current = volumeSeries;

    const resizeObserver = new ResizeObserver(() => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    });
    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [theme]);

  useEffect(() => {
    if (!candleRef.current || !volumeRef.current || !data.length) return;

    const candles = data.map((b) => ({
      time: Math.floor(b.t / 1000) as unknown as number,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
    }));

    const volumes = data.map((b) => ({
      time: Math.floor(b.t / 1000) as unknown as number,
      value: b.v,
      color: b.c >= b.o ? "#1ed68833" : "#ff5c5c33",
    }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    candleRef.current.setData(candles as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    volumeRef.current.setData(volumes as any);
    chartRef.current?.timeScale().fitContent();
  }, [data]);

  return <div ref={containerRef} className="w-full h-full" />;
}
