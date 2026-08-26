import { wormholes } from '@astroscope/wormhole';
import { useWormhole } from '@astroscope/wormhole/react';

export default function ConfigDisplay() {
  const config = useWormhole(wormholes.config);

  return (
    <div>
      <p>
        <strong>Site name:</strong> {config.siteName}
      </p>
      <div className="flex gap-2 mt-2">
        {config.features.map((feature) => (
          <span key={feature} className="badge badge-primary">
            {feature}
          </span>
        ))}
      </div>
    </div>
  );
}
