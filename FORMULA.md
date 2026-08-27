# MovieScore Formula v1.1

Let:

- I = IMDb rating × 10
- L = Letterboxd rating × 20
- M = Metacritic score
- Nᵢ = IMDb vote count
- Nₗ = Letterboxd rating count
- Nₘ = Metacritic critic-review count

Confidence:

    Cᵢ = Nᵢ / (Nᵢ + 10,000)
    Cₗ = Nₗ / (Nₗ + 2,000)
    Cₘ = Nₘ / (Nₘ + 20)

Audience:

    A = (0.60·Cᵢ·I + 0.40·Cₗ·L) /
        (0.60·Cᵢ + 0.40·Cₗ)

Audience confidence:

    Qₐ = 0.60·Cᵢ + 0.40·Cₗ

Critics:

    C = M
    Q꜀ = Cₘ

Final:

    Final =
      (0.55·Q꜀·C + 0.45·Qₐ·A) /
      (0.55·Q꜀ + 0.45·Qₐ)

Rotten Tomatoes Tomatometer is intentionally excluded from the numerical formula because it measures the share of positive reviews, not an average review grade.

Implementation note:
When one audience source is unavailable, its base weight is removed and the remaining source weights are re-normalized. The same principle applies if an entire critic/audience side is unavailable.
