"""
Configuration management.
All org/enterprise info is auto-discovered via GitHub API.
PAT token and sync settings are configured via environment variables.
"""

from pathlib import Path

# Project root
PROJECT_ROOT = Path(__file__).parent.parent.parent
DATA_DIR = PROJECT_ROOT / "data"

# Copilot plan pricing (USD/month/user)
COPILOT_PRICING = {
    "business": 19.0,
    "enterprise": 39.0,
}

# GitHub AI Credits (AIC) — new billing model effective June 1, 2026
# 1 AIC = $0.01 USD
AIC_VALUE_USD = 0.01

# Standard monthly AIC included per user
AIC_INCLUDED_PER_USER = {
    "business": 1900,
    "enterprise": 3900,
}

# Promotional period: June 1 – September 1, 2026
AIC_PROMO_PER_USER = {
    "business": 3000,
    "enterprise": 7000,
}
AIC_PROMO_START = "2026-06-01"
AIC_PROMO_END = "2026-09-01"


class AppConfig:
    def __init__(self):
        self.github_api_base: str = "https://api.github.com"
        self.data_dir: Path = DATA_DIR
        self.db_path: Path = DATA_DIR / "octofinance.db"
        self.data_dir.mkdir(parents=True, exist_ok=True)


# Global config instance
config = AppConfig()
