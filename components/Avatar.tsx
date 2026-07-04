// Host-rendered avatar (contract §2): always embed {host}/api/avatar/{id}.svg,
// never draw locally. One place for the img-or-placeholder pattern plus the
// identity ring — a border in the brand color of the player's biggest holding
// (TASK-coingame-15). Box-sizing is border-box globally, so `size` is the
// full footprint including the ring.

export default function Avatar({
  url, name, size, ring,
}: {
  url: string | null;
  name: string;
  size: number;
  ring: string;
}) {
  const style = { width: size, height: size, borderColor: ring };
  return url ? (
    // eslint-disable-next-line @next/next/no-img-element -- host-rendered SVG avatar (contract §2)
    <img className="avatar" src={url} alt={name} width={size} height={size} style={style} />
  ) : (
    <span className="avatar" style={style} aria-hidden="true" />
  );
}
