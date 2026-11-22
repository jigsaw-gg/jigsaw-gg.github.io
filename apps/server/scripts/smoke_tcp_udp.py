#!/usr/bin/env python3
"""Quick TCP/UDP relay smoke test against a running local server."""

from __future__ import annotations

import socket
import struct
import time


def frame(payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + payload


def read_frame(sock: socket.socket) -> bytes:
    header = sock.recv(4)
    if len(header) != 4:
        raise RuntimeError("short length header")
    (n,) = struct.unpack(">I", header)
    data = b""
    while len(data) < n:
        chunk = sock.recv(n - len(data))
        if not chunk:
            raise RuntimeError("connection closed mid-frame")
        data += chunk
    return data


def main() -> None:
    a = socket.create_connection(("127.0.0.1", 21102))
    b = socket.create_connection(("127.0.0.1", 21102))
    a.sendall(frame(b"JOIN demo alice"))
    b.sendall(frame(b"JOIN demo bob"))
    time.sleep(0.2)
    a.sendall(frame(b"hello-tcp"))
    b.settimeout(2)
    print("tcp_relay_ok", read_frame(b))
    a.close()
    b.close()

    ua = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    ub = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    ua.sendto(b"JOIN demo ua", ("127.0.0.1", 31101))
    ub.sendto(b"JOIN demo ub", ("127.0.0.1", 31101))
    time.sleep(0.2)
    ua.sendto(b"hello-udp", ("127.0.0.1", 31101))
    ub.settimeout(2)
    msg, _ = ub.recvfrom(65535)
    print("udp_relay_ok", msg)


if __name__ == "__main__":
    main()
