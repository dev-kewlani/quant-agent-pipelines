import { useEffect, useRef, useCallback } from 'react';
import { useMarketDataStore } from '@/stores/marketDataStore';
import { useMacroStore } from '@/stores/macroStore';
import type { ServerMessage, ClientMessage } from '@/types/ws';

export function useWebSocket(url: string) {
  const wsRef = useRef<WebSocket | null>(null);
  const updateQuotes = useMarketDataStore((s) => s.updateQuotes);
  const setConnectionStatus = useMarketDataStore((s) => s.setConnectionStatus);
  const setHistoricalData = useMarketDataStore((s) => s.setHistoricalData);
  const addVolumeAlert = useMarketDataStore((s) => s.addVolumeAlert);
  const setMacroData = useMacroStore((s) => s.setMacroData);

  useEffect(() => {
    let reconnectTimeout: ReturnType<typeof setTimeout>;
    let reconnectDelay = 1000;
    let unmounted = false;

    function connect() {
      if (unmounted) return;
      setConnectionStatus('connecting');

      const ws = new WebSocket(url);

      ws.onopen = () => {
        if (unmounted) { ws.close(); return; }
        setConnectionStatus('connected');
        reconnectDelay = 1000;
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as ServerMessage;
          switch (msg.type) {
            case 'QUOTES_UPDATE':
              updateQuotes(msg.data);
              break;
            case 'CONNECTION_STATUS':
              setConnectionStatus(msg.status);
              break;
            case 'HISTORICAL_DATA':
              setHistoricalData(msg.symbol, msg.bars);
              break;
            case 'MACRO_UPDATE':
              setMacroData(msg.data);
              break;
            case 'VOLUME_ALERT':
              addVolumeAlert(msg.alert);
              break;
          }
        } catch {
          // Ignore parse errors
        }
      };

      ws.onclose = () => {
        if (unmounted) return;
        setConnectionStatus('disconnected');
        reconnectTimeout = setTimeout(() => {
          reconnectDelay = Math.min(reconnectDelay * 2, 30000);
          connect();
        }, reconnectDelay);
      };

      ws.onerror = () => {
        // onclose will fire after this
      };

      wsRef.current = ws;
    }

    connect();

    return () => {
      unmounted = true;
      clearTimeout(reconnectTimeout);
      wsRef.current?.close();
    };
  }, [url, updateQuotes, setConnectionStatus, setHistoricalData, setMacroData, addVolumeAlert]);

  const send = useCallback((msg: ClientMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  return { send };
}
