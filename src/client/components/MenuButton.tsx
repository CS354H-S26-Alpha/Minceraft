export function MenuButton(props: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      class="w-full border-2 border-black bg-[linear-gradient(180deg,#b8b8b8,#8d8d8d)] px-4 py-3 text-center font-mono text-[15px] font-bold tracking-[0.04em] text-white [box-shadow:inset_0_1px_0_rgba(255,255,255,0.38),inset_0_-2px_0_rgba(0,0,0,0.32)] [text-shadow:0_2px_0_rgba(0,0,0,0.72)] transition hover:bg-[linear-gradient(180deg,#cdcdcd,#9a9a9a)] focus:outline-none focus:ring-2 focus:ring-white/70"
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}
