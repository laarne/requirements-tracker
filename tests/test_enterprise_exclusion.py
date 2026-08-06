import os
import json
import pytest
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent

def test_migration_sql_exists():
    migration_file = BASE_DIR / "migrations" / "001_excluded_enterprises.sql"
    assert migration_file.exists(), "001_excluded_enterprises.sql migration file must exist"
    content = migration_file.read_text(encoding="utf-8")
    assert "excluded_enterprises" in content
    assert "enterprise_key" in content
    assert "active" in content

def test_schema_sql_has_excluded_enterprises():
    schema_file = BASE_DIR / "schema.sql"
    assert schema_file.exists()
    content = schema_file.read_text(encoding="utf-8")
    assert "public.excluded_enterprises" in content

def test_scan_api_has_exclusion_check():
    scan_js = BASE_DIR / "api" / "scan.js"
    assert scan_js.exists()
    content = scan_js.read_text(encoding="utf-8")
    assert "excluded_enterprises" in content
    assert "isExcluded" in content
    assert "Skipping excluded enterprise" in content

def test_app_js_has_exclusion_handling():
    app_js = BASE_DIR / "app.js"
    assert app_js.exists()
    content = app_js.read_text(encoding="utf-8")
    assert "fetchExclusionsFromSupabase" in content
    assert "isEnterpriseExcluded" in content
    assert "excludeEnterprise" in content
    assert "restoreEnterprise" in content
    assert "modal-confirm-remove-overlay" in content
    assert "modal-excluded-list-overlay" in content
