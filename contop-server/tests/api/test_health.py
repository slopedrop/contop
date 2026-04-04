"""
API tests for health and root endpoints.
"""


def test_health_returns_200(client):
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert data["service"] == "contop-server"


def test_root_returns_service_info(client):
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["service"] == "contop-server"
    assert "description" in data
