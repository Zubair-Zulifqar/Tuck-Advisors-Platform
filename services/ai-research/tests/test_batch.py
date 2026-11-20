from tuck_scoring.batch import facts_from_company, main, parse_employee_range


def test_parse_employee_range():
    assert parse_employee_range("51-200") == 125.5
    assert parse_employee_range("5000+") == 5000
    assert parse_employee_range("1,001-5,000") == 3000.5
    assert parse_employee_range(None) is None
    assert parse_employee_range("unknown") is None


def test_facts_from_company_uses_only_crm_columns():
    f = facts_from_company({
        "name": "Acme",
        "industry": "Logistics software",
        "tags": ["target"],
        "headquarters": "Germany",
        "employee_range": "11-50",
        "custom_fields": '{"products": "routing, telematics", "revenue_usd": 12000000}',
    })
    assert f.products == ["routing", "telematics"]
    assert f.geographies == ["Germany"]
    assert f.employee_count == 30.5
    assert f.revenue_usd == 12_000_000 and f.revenue_verified is False


def test_batch_requires_database_url(monkeypatch, capsys):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    assert main(["--org", "00000000-0000-4000-8000-000000000001"]) == 2
