use serde::Serialize;

use super::LocalStoreError;

#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PricedLine {
    pub unit_net_minor: i64,
    pub unit_tax_minor: i64,
    pub unit_total_minor: i64,
    pub line_subtotal_minor: i64,
    pub line_tax_minor: i64,
    pub line_total_minor: i64,
}

pub fn price_line(
    product_price_minor: i64,
    modifier_deltas: &[i64],
    quantity: i64,
    tax_rate_bp: i64,
    tax_mode: &str,
) -> Result<PricedLine, LocalStoreError> {
    if product_price_minor < 0 || quantity <= 0 || !(0..=100_000).contains(&tax_rate_bp) {
        return Err(LocalStoreError::InvalidOrder);
    }
    let base = modifier_deltas
        .iter()
        .try_fold(i128::from(product_price_minor), |sum, v| {
            sum.checked_add(i128::from(*v))
        })
        .ok_or(LocalStoreError::InvalidOrder)?;
    if base < 0 {
        return Err(LocalStoreError::InvalidOrder);
    }
    let rate = i128::from(tax_rate_bp);
    let scale = 10_000_i128;
    let (net, tax, total) = match tax_mode {
        "EXCLUSIVE" => {
            let tax = round_half_up(
                base.checked_mul(rate)
                    .ok_or(LocalStoreError::InvalidOrder)?,
                scale,
            )?;
            (
                base,
                tax,
                base.checked_add(tax).ok_or(LocalStoreError::InvalidOrder)?,
            )
        }
        "INCLUSIVE" => {
            let net = round_half_up(
                base.checked_mul(scale)
                    .ok_or(LocalStoreError::InvalidOrder)?,
                scale
                    .checked_add(rate)
                    .ok_or(LocalStoreError::InvalidOrder)?,
            )?;
            let tax = base.checked_sub(net).ok_or(LocalStoreError::InvalidOrder)?;
            (net, tax, base)
        }
        _ => return Err(LocalStoreError::InvalidOrder),
    };
    let qty = i128::from(quantity);
    Ok(PricedLine {
        unit_net_minor: to_i64(net)?,
        unit_tax_minor: to_i64(tax)?,
        unit_total_minor: to_i64(total)?,
        line_subtotal_minor: to_i64(net.checked_mul(qty).ok_or(LocalStoreError::InvalidOrder)?)?,
        line_tax_minor: to_i64(tax.checked_mul(qty).ok_or(LocalStoreError::InvalidOrder)?)?,
        line_total_minor: to_i64(
            total
                .checked_mul(qty)
                .ok_or(LocalStoreError::InvalidOrder)?,
        )?,
    })
}
fn round_half_up(n: i128, d: i128) -> Result<i128, LocalStoreError> {
    if n < 0 || d <= 0 {
        return Err(LocalStoreError::InvalidOrder);
    }
    n.checked_add(d / 2)
        .and_then(|v| v.checked_div(d))
        .ok_or(LocalStoreError::InvalidOrder)
}
fn to_i64(v: i128) -> Result<i64, LocalStoreError> {
    i64::try_from(v).map_err(|_| LocalStoreError::InvalidOrder)
}

// Windows CI: see catalog.rs's tests' own comment and issue #8 --
// STATUS_STACK_OVERFLOW turned out not to be specific to any one test or
// module; this whole test suite is unreliable on windows-latest debug
// builds pending real Windows debugging access.
#[cfg(all(test, not(target_os = "windows")))]
mod tests {
    use super::*;
    #[test]
    fn integer_pricing_is_deterministic() {
        assert_eq!(
            price_line(10_000, &[], 2, 1_800, "EXCLUSIVE").unwrap(),
            PricedLine {
                unit_net_minor: 10_000,
                unit_tax_minor: 1_800,
                unit_total_minor: 11_800,
                line_subtotal_minor: 20_000,
                line_tax_minor: 3_600,
                line_total_minor: 23_600
            }
        );
        assert_eq!(
            price_line(11_800, &[], 1, 1_800, "INCLUSIVE")
                .unwrap()
                .unit_tax_minor,
            1_800
        );
        assert_eq!(
            price_line(100, &[50], 2, 0, "EXCLUSIVE")
                .unwrap()
                .line_total_minor,
            300
        );
        assert!(price_line(10, &[-11], 1, 0, "EXCLUSIVE").is_err());
        assert!(price_line(i64::MAX, &[i64::MAX], 2, 100_000, "EXCLUSIVE").is_err());
    }
}
