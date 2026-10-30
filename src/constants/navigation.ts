import type { NativeStackNavigationOptions } from 'expo-router';
import { Platform } from 'react-native';

import { exerciseSearch, pickerSearch } from '@/services/search-query';

/** From iOS 26 the system draws bars in Liquid Glass and fades the content scrolling under them. */
const liquidGlass = Platform.OS === 'ios' && Number.parseInt(String(Platform.Version), 10) >= 26;

/**
 * Header of the stacks inside the tabs, as in Apple's apps: the bar floats over the page and
 * the scroll view runs under it. With an opaque bar iOS resizes the whole screen on every frame
 * of the large title collapsing, which is what made it stutter.
 */
export const TAB_STACK_OPTIONS: NativeStackNavigationOptions = {
  headerTransparent: true,
  headerShadowVisible: false,
  headerLargeTitleShadowVisible: false,
  headerLargeStyle: { backgroundColor: 'transparent' },
  // Before iOS 26 there is no scroll edge effect, so the collapsed bar needs its own blur.
  headerBlurEffect: liquidGlass ? undefined : 'systemChromeMaterial',
  headerBackButtonDisplayMode: 'minimal',
};

/** For the first screen of each tab. */
export const LARGE_TITLE: NativeStackNavigationOptions = { headerLargeTitleEnabled: true };

/**
 * The search bars of the exercise lists. Whole in the layout, so iOS has them in the bar from the
 * first frame of the push and never rebuilds them: the screens read the text from search-query.
 */
const SEARCH = { placeholder: 'Cerca: panca, squat, curl…', hideWhenScrolling: false };
export const EXERCISE_SEARCH = {
  ...SEARCH,
  // Under the title, not at the foot of the screen where iOS 26 puts it: there the app's own tab
  // bar would cover it.
  placement: 'stacked',
  onChangeText: exerciseSearch.onChangeText,
} satisfies NativeStackNavigationOptions['headerSearchBarOptions'];
export const PICKER_SEARCH = {
  ...SEARCH,
  onChangeText: pickerSearch.onChangeText,
} satisfies NativeStackNavigationOptions['headerSearchBarOptions'];
