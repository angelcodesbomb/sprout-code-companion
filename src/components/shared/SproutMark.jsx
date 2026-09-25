export function SproutMark({ compact = false }) {
  return (
    <div className="sprout-mark" aria-label="Sprout">
      <span className="sprout-mark__icon" aria-hidden="true">
        <span className="sprout-mark__leaf sprout-mark__leaf--left" />
        <span className="sprout-mark__leaf sprout-mark__leaf--right" />
        <span className="sprout-mark__stem" />
      </span>
      {!compact && <span className="sprout-mark__word">sprout</span>}
    </div>
  );
}
