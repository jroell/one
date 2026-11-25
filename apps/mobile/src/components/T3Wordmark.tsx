import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";
import { withUniwind } from "uniwind";

const ThemedPath = withUniwind(Path);

export function T3Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  return (
    // oxlint-disable-next-line t3code/no-untranslated-copy -- product name
    <Svg accessibilityLabel="One" height={props.height} width={props.height} viewBox="0 0 24 24">
      <ThemedPath
        d="M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20ZM12 5.8a6.2 6.2 0 1 1 0 12.4a6.2 6.2 0 1 1 0-12.4Z"
        fillRule="evenodd"
        color={props.color}
        colorClassName={props.colorClassName}
        fill="currentColor"
      />
    </Svg>
  );
}
