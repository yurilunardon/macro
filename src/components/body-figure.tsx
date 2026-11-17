import { Asset } from 'expo-asset';
import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

import { isMuscle } from '@/lib/exercises';

import { parseBodyMessage, type BodyFigureProps } from './body-figure.types';

/**
 * The body in 3D, each muscle coloured by how the program trains it. It is a page drawn with
 * WebGL in a web view (`scripts/body`): one file with the model inside, read from the app itself.
 */
export function BodyFigure({ state, onSelect, onFail, onReady, ref }: BodyFigureProps) {
  // Its own type takes `undefined` for extra props, which leaves no props at all.
  const web = useRef<WebView<object>>(null);
  const [uri, setUri] = useState<string | null>(null);
  const json = JSON.stringify(state);
  // What the page starts with; later changes are sent to it.
  const [first] = useState(json);

  useEffect(() => {
    let on = true;
    const asset = Asset.fromModule(require('../../assets/body/body.html'));
    asset
      .downloadAsync()
      .then(() => on && setUri(asset.localUri ?? asset.uri))
      .catch(() => onFail?.());
    return () => {
      on = false;
    };
    // Once: the file never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    web.current?.injectJavaScript(`window.fuel&&window.fuel.set(${json});true;`);
  }, [json]);

  useImperativeHandle(
    ref,
    () => ({ select: (muscle) => web.current?.injectJavaScript(`window.fuel&&window.fuel.select(${JSON.stringify(muscle)});true;`) }),
    [],
  );

  if (uri === null) return null;
  return (
    <WebView<object>
      ref={web}
      source={{ uri }}
      originWhitelist={['*']}
      allowFileAccess
      allowingReadAccessToURL={uri}
      injectedJavaScriptBeforeContentLoaded={`window.__fuel=${first};true;`}
      onMessage={(event) => {
        const message = parseBodyMessage(event.nativeEvent.data);
        if (message?.type === 'ready') {
          web.current?.injectJavaScript(`window.fuel.set(${json});true;`);
          onReady?.();
        }
        else if (message?.type === 'failed') onFail?.();
        else if (message?.type === 'select' && isMuscle(message.muscle)) onSelect(message.muscle);
      }}
      scrollEnabled={false}
      bounces={false}
      overScrollMode="never"
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      // The page draws on nothing: the screen's own background shows while it loads.
      style={styles.web}
      containerStyle={styles.web}
    />
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: 'transparent' },
});
