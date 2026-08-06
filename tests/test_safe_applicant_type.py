import os
import json
import pytest
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent

def test_modal_elements_exist_in_index():
    index_html = BASE_DIR / "index.html"
    assert index_html.exists()
    content = index_html.read_text(encoding="utf-8")
    assert 'id="modal-change-app-type-overlay"' in content
    assert 'id="app-type-step-select"' in content
    assert 'id="app-type-step-confirm"' in content
    assert 'id="btn-app-type-continue"' in content
    assert 'id="btn-app-type-confirm"' in content

def test_read_only_badge_and_edit_button_in_app():
    app_js = BASE_DIR / "app.js"
    assert app_js.exists()
    content = app_js.read_text(encoding="utf-8")
    assert 'btn-drawer-choose-type' in content or 'btn-header-edit-type' in content
    assert 'openChangeAppTypeModal' in content
    assert 'setApplicantTypeOverride' in content

def test_recalculate_scores_differentiates_individual_and_group():
    app_js = BASE_DIR / "app.js"
    content = app_js.read_text(encoding="utf-8")
    assert "recalculateEnterpriseScores" in content
    assert "_applicantType" in content
    assert "human_reviews" in content
