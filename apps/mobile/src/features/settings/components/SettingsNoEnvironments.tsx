import { useGT } from "gt-react-native";
import { useNavigation } from "@react-navigation/native";

import { EmptyState } from "../../../components/ui/EmptyState";
import { openSettings } from "../settings-navigation";

/** The page's body when no environment is connected: says why it is empty and offers the fix. */
export function SettingsNoEnvironments(props: { readonly detail: string }) {
  const gt = useGT();
  const navigation = useNavigation();
  return (
    <EmptyState
      variant="plain"
      title={gt("No environments connected")}
      detail={props.detail}
      actionLabel={gt("Add environment")}
      onAction={() => openSettings(navigation, "SettingsEnvironmentNew")}
    />
  );
}
