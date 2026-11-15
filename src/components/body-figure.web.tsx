import { Asset } from 'expo-asset';
import { useEffect, useImperativeHandle, useRef } from 'react';

import { isMuscle } from '@/lib/exercises';

import { parseBodyMessage, type BodyFigureProps } from './body-figure.types';

/** On the web the same page sits in a frame, and is written to with messages. */
export function BodyFigure({ state, onSelect, onFail, ref }: BodyFigureProps) {
  const frame = useRef<HTMLIFrameElement>(null);
  const uri = Asset.fromModule(require('../../assets/body/body.html')).uri;
  const json = JSON.stringify(state);
  const latest = useRef({ json, onSelect, onFail });
  useEffect(() => {
    latest.current = { json, onSelect, onFail };
  });

  const send = (message: object) => frame.current?.contentWindow?.postMessage(JSON.stringify(message), '*');

  useEffect(() => {
    send({ fuel: 'set', state: JSON.parse(json) });
  }, [json]);

  useEffect(() => {
    const listen = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const message = parseBodyMessage(event.data);
      if (message?.type === 'ready') send({ fuel: 'set', state: JSON.parse(latest.current.json) });
      else if (message?.type === 'failed') latest.current.onFail?.();
      else if (message?.type === 'select' && isMuscle(message.muscle)) latest.current.onSelect(message.muscle);
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, []);

  useImperativeHandle(ref, () => ({ select: (muscle) => send({ fuel: 'select', muscle }) }), []);

  return <iframe ref={frame} src={uri} title="Il corpo in 3D" style={{ flex: 1, width: '100%', height: '100%', border: 0, background: 'transparent' }} />;
}
