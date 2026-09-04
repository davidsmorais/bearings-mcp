import type { Place } from "@bearings/shared";

const samplePlace: Place = {
  name: "Null Island",
  coordinates: { lat: 0, lon: 0 },
};

export const App = () => {
  return (
    <main>
      <h1>Bearings Inspector</h1>
      <p>
        {samplePlace.name} @ {samplePlace.coordinates.lat}, {samplePlace.coordinates.lon}
      </p>
    </main>
  );
};
