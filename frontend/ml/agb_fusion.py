"""
AGB Fusion Module — Inverse Variance Weighting (IVW)
-----------------------------------------------------
Combines satellite and drone AGB estimates into a single
fused estimate that is more accurate than either source alone.

MATHEMATICAL BASIS & CITATIONS
--------------------------------
The Inverse Variance Weighting (IVW) method used here is the
Best Linear Unbiased Estimator (BLUE) for combining independent
unbiased estimates. It is derived from the Gauss-Markov theorem.

Primary statistical reference:
    Cochran, W.G. (1937). Problems arising in the analysis of a
    series of similar experiments. Journal of the Royal Statistical
    Society, 4(Suppl.), 102-118.
    https://doi.org/10.2307/2984123

    Hartung, J., Knapp, G., & Sinha, B.K. (2008).
    Statistical Meta-Analysis with Applications.
    Wiley. ISBN: 978-0-470-29089-7
    (Chapter 2: Fixed-Effects Model, IVW estimator, pp. 24-30)

Formulas used:
    Weight:         w_i = 1 / sigma_i^2
    Fused estimate: AGB_fused = sum(w_i * AGB_i) / sum(w_i)
    Fused variance: Var = 1 / sum(w_i)
    Fused std dev:  sigma_fused = sqrt(1 / sum(w_i))

    Source: Borenstein, M., Hedges, L.V., Higgins, J.P.T., &
            Rothstein, H.R. (2009). Introduction to Meta-Analysis.
            Wiley. ISBN: 978-0-470-05724-7
            (Chapter 11: Combining Estimates Across Studies, pp. 61-67)

Application to remote sensing / AGB fusion:
    Rejou-Mechain, M., Tanguy, A., Piponiot, C., Chave, J., &
    Herault, B. (2017). biomass: An R Package for Estimating
    Above-Ground Biomass and Its Uncertainty in Tropical Forests.
    Methods in Ecology and Evolution, 8(9), 1163-1167.
    https://doi.org/10.1111/2041-210X.12753

    Avitabile, V., Herold, M., Heuvelink, G.B.M., et al. (2016).
    An integrated pan-tropical biomass map using multiple reference
    datasets. Global Change Biology, 22(4), 1406-1420.
    https://doi.org/10.1111/gcb.13139
    (Section 2.3: variance-weighted fusion of AGB maps)

95% Confidence Interval:
    The 1.96 multiplier assumes a normal (Gaussian) distribution,
    following the Central Limit Theorem.
    Source: Casella, G., & Berger, R.L. (2002). Statistical
            Inference (2nd ed.). Duxbury. ISBN: 978-0-534-24312-8

Usage:
    from agb_fusion import fuse_agb, FusionResult
"""

from dataclasses import dataclass
import math


@dataclass
class AGBEstimate:
    """
    Single AGB estimate with its uncertainty.

    Attributes:
        agb     : Above-ground biomass density in t/ha
        std_dev : Standard deviation (sigma) in t/ha
        source  : Label for logging (e.g. 'satellite', 'drone')
    """
    agb: float
    std_dev: float
    source: str = ""

    def __post_init__(self):
        if self.std_dev <= 0:
            raise ValueError(
                f"std_dev must be > 0 for source '{self.source}'. "
                f"Got {self.std_dev}. Check your model outputs."
            )
        if self.agb < 0:
            raise ValueError(
                f"AGB cannot be negative for source '{self.source}'. "
                f"Got {self.agb}."
            )

    @property
    def variance(self) -> float:
        """sigma^2 — used as the denominator for IVW weight."""
        return self.std_dev ** 2

    @property
    def ivw_weight(self) -> float:
        """
        Inverse variance weight: w_i = 1 / sigma_i^2
        Ref: Borenstein et al. (2009), Chapter 11, Eq. 11.2
        """
        return 1.0 / self.variance

    def ci_95(self) -> tuple[float, float]:
        """
        95% confidence interval using z = 1.96 (normal approximation).
        Ref: Casella & Berger (2002)
        """
        margin = 1.96 * self.std_dev
        return (max(0.0, self.agb - margin), self.agb + margin)


@dataclass
class FusionResult:
    """
    Output of the IVW fusion.

    Attributes:
        agb_fused    : Fused AGB density (t/ha)
        std_dev      : Fused uncertainty sigma_fused (t/ha)
        weight_sat   : Fractional weight from satellite [0-1]
        weight_drone : Fractional weight from drone [0-1]
        ci_lower     : Lower bound of 95% CI (t/ha)
        ci_upper     : Upper bound of 95% CI (t/ha)
    """
    agb_fused: float
    std_dev: float
    weight_sat: float
    weight_drone: float
    ci_lower: float
    ci_upper: float

    def __str__(self) -> str:
        return (
            f"\n{'='*52}\n"
            f"  Fused AGB Result (Inverse Variance Weighting)\n"
            f"  Ref: Borenstein et al. (2009); Avitabile et al. (2016)\n"
            f"{'='*52}\n"
            f"  AGB (fused)   : {self.agb_fused:.4f} t/ha\n"
            f"  Uncertainty   : +/-{self.std_dev:.4f} t/ha\n"
            f"  95% CI        : [{self.ci_lower:.4f}, {self.ci_upper:.4f}] t/ha\n"
            f"{'─'*52}\n"
            f"  Weight (satellite) : {self.weight_sat*100:.1f}%\n"
            f"  Weight (drone)     : {self.weight_drone*100:.1f}%\n"
            f"{'='*52}\n"
        )


def fuse_agb(satellite: AGBEstimate, drone: AGBEstimate) -> FusionResult:
    """
    Fuse satellite and drone AGB estimates using Inverse Variance Weighting.

    This is the minimum-variance linear unbiased estimator (BLUE)
    for combining two independent Gaussian estimates.

    Formulas (Borenstein et al., 2009, Ch. 11):
        w_i         = 1 / sigma_i^2
        AGB_fused   = sum(w_i * AGB_i) / sum(w_i)
        sigma_fused = sqrt(1 / sum(w_i))

    Applied to AGB remote sensing per Avitabile et al. (2016), Sec. 2.3.

    Args:
        satellite : AGBEstimate from the satellite AGB model
        drone     : AGBEstimate from the drone/GPR model

    Returns:
        FusionResult with fused AGB, uncertainty, per-source weights, and CI
    """
    # Step 1: compute IVW weights — w_i = 1 / sigma_i^2
    # Ref: Borenstein et al. (2009), Eq. 11.2
    w_sat   = satellite.ivw_weight    # 1 / sigma_sat^2
    w_drone = drone.ivw_weight        # 1 / sigma_drone^2
    sum_w   = w_sat + w_drone         # sum of w_i

    # Step 2: fused AGB — weighted average
    # Ref: Borenstein et al. (2009), Eq. 11.3
    agb_fused = (w_sat * satellite.agb + w_drone * drone.agb) / sum_w

    # Step 3: fused uncertainty — always smaller than both individual inputs
    # Var(AGB_fused) = 1 / sum(w_i)  =>  sigma_fused = sqrt(1 / sum(w_i))
    # Ref: Borenstein et al. (2009), Eq. 11.4
    sigma_fused = math.sqrt(1.0 / sum_w)

    # Step 4: 95% CI on fused estimate (z = 1.96, normal approximation)
    # Ref: Casella & Berger (2002)
    margin   = 1.96 * sigma_fused
    ci_lower = max(0.0, agb_fused - margin)
    ci_upper = agb_fused + margin

    # Fractional weights — shows how much each source contributed
    frac_sat   = w_sat   / sum_w
    frac_drone = w_drone / sum_w

    return FusionResult(
        agb_fused    = agb_fused,
        std_dev      = sigma_fused,
        weight_sat   = frac_sat,
        weight_drone = frac_drone,
        ci_lower     = ci_lower,
        ci_upper     = ci_upper,
    )


# ---------------------------------------------------------------------------
# Example — plug in your model outputs here
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    sat   = AGBEstimate(agb=51.15, std_dev=37.25, source="satellite")
    drone = AGBEstimate(agb=45.00, std_dev=10.00, source="drone")

    result = fuse_agb(sat, drone)
    print(result)

    print(f"Satellite 95% CI : {sat.ci_95()}")
    print(f"Drone     95% CI : {drone.ci_95()}")
    print(f"Fused     95% CI : ({result.ci_lower:.4f}, {result.ci_upper:.4f})")