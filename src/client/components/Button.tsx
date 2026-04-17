// Button styling adapted from hc-tcg (https://github.com/hc-tcg/hc-tcg).
import type { JSX } from "solid-js";
import { splitProps } from "solid-js";

type Variant = "primary" | "accent" | "ghost";

interface ButtonProps extends JSX.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
}

const BASE =
  "btn-mc inline-flex items-center justify-center px-3 py-1.5 leading-none text-white select-none active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "btn-mc-primary",
  accent: "btn-mc-accent",
  ghost: "btn-mc-ghost",
};

export function Button(props: ButtonProps) {
  const [local, rest] = splitProps(props, ["variant", "class", "children"]);
  const variantClass = () => VARIANT_CLASS[local.variant ?? "primary"];
  return (
    <button type="button" {...rest} class={`${BASE} ${variantClass()} ${local.class ?? ""}`}>
      <span class="-translate-y-px">{local.children}</span>
    </button>
  );
}
