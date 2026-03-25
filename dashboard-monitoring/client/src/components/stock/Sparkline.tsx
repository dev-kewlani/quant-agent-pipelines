import { Component, useEffect, useRef, type ReactNode } from 'react';
import { createChart, ColorType, type IChartApi } from 'lightweight-charts';
import { useMarketDataStore } from '@/stores/marketDataStore';

// Error boundary to prevent Sparkline crashes from taking down the whole app
class SparklineErrorBoundary extends Component<
  { children: ReactNode; width: number; height: number },
  { hasError: boolean }
> {
  constructor(props: { children: ReactNode; width: number; height: number }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          className="flex items-center justify-center text-zinc-700 text-xs"
          style={{ width: this.props.width, height: this.props.height }}
        >
          --
        </div>
      );
    }
    return this.props.children;
  }
}

interface SparklineProps {
  symbol: string;
  width?: number;
  height?: number;
}

function SparklineChart({ symbol, width = 120, height = 36 }: SparklineProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const bars = useMarketDataStore((s) => s.historicalData[symbol]);

  useEffect(() => {
    if (!containerRef.current || !bars || bars.length === 0) return;

    // Clean up previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
    }

    try {
      const firstClose = bars[0].close;
      const lastClose = bars[bars.length - 1].close;
      const lineColor = lastClose >= firstClose ? '#34d399' : '#f87171';

      const chart = createChart(containerRef.current, {
        width,
        height,
        layout: {
          background: { type: ColorType.Solid, color: 'transparent' },
          textColor: 'transparent',
          attributionLogo: false,
        },
        grid: {
          vertLines: { visible: false },
          horzLines: { visible: false },
        },
        crosshair: {
          vertLine: { visible: false },
          horzLine: { visible: false },
        },
        rightPriceScale: { visible: false },
        timeScale: { visible: false },
        handleScroll: false,
        handleScale: false,
      });

      const series = chart.addAreaSeries({
        lineColor,
        topColor: lineColor + '30',
        bottomColor: 'transparent',
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });

      const data = bars.map((b) => ({
        time: b.time as string,
        value: b.close,
      }));
      series.setData(data);
      chart.timeScale().fitContent();

      chartRef.current = chart;

      return () => {
        chart.remove();
        chartRef.current = null;
      };
    } catch {
      // Chart creation can fail in some environments
      return undefined;
    }
  }, [bars, width, height]);

  if (!bars || bars.length === 0) {
    return (
      <div
        className="flex items-center justify-center text-zinc-700 text-xs"
        style={{ width, height }}
      >
        --
      </div>
    );
  }

  return <div ref={containerRef} style={{ width, height }} />;
}

export function Sparkline({ symbol, width = 120, height = 36 }: SparklineProps) {
  return (
    <SparklineErrorBoundary width={width} height={height}>
      <SparklineChart symbol={symbol} width={width} height={height} />
    </SparklineErrorBoundary>
  );
}
