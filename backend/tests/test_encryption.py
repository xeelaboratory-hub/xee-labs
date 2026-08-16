from app.security.encryption import decrypt_json, encrypt_json


def test_round_trip():
    payload = {"apiKey": "k", "apiSecret": "s", "passphrase": "p"}
    blob = encrypt_json(payload)
    assert blob != str(payload).encode()
    assert decrypt_json(blob) == payload
