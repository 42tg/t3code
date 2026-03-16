import { memo, useState } from "react";
import { type ClaudeContextWindowMode } from "@t3tools/shared/model";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Menu, MenuGroup, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";

export const ClaudeTraitsPicker = memo(function ClaudeTraitsPicker(props: {
  contextWindowMode: ClaudeContextWindowMode;
  largeContextEnabled: boolean;
  onLargeContextChange: (enabled: boolean) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const triggerLabel =
    props.contextWindowMode === "1m-native"
      ? "1M ctx"
      : props.contextWindowMode === "1m-beta" && props.largeContextEnabled
        ? "1M ctx"
        : props.contextWindowMode === "200k"
          ? "200k ctx"
          : "200k ctx";

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        setIsMenuOpen(open);
      }}
    >
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 sm:px-3"
          />
        }
      >
        <span>{triggerLabel}</span>
        <ChevronDownIcon aria-hidden="true" className="size-3 opacity-60" />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuGroup>
          <div className="px-2 py-1.5 font-medium text-muted-foreground text-xs">
            Context Window
          </div>
          {props.contextWindowMode === "1m-native" ? (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              1M tokens — native for this model
            </div>
          ) : props.contextWindowMode === "1m-beta" ? (
            <MenuRadioGroup
              value={props.largeContextEnabled ? "1m" : "200k"}
              onValueChange={(value) => {
                props.onLargeContextChange(value === "1m");
                setIsMenuOpen(false);
              }}
            >
              <MenuRadioItem value="200k">200k (default)</MenuRadioItem>
              <MenuRadioItem value="1m">
                1M
                <span className="ms-1.5 text-[10px] text-muted-foreground">(beta, tier 4+)</span>
              </MenuRadioItem>
            </MenuRadioGroup>
          ) : (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              200k tokens — this model does not support 1M context
            </div>
          )}
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
});
