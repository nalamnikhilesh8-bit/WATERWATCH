#!/usr/bin/env python
import os
import sys

try:
    import MySQLdb  # mysqlclient
except ImportError:
    try:
        import pymysql
        pymysql.install_as_MySQLdb()
    except ImportError:
        pass

if __name__ == "__main__":
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "waterwatch_core.settings")
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:
        raise ImportError("Django is not installed. Install backend/requirements.txt first.") from exc
    execute_from_command_line(sys.argv)
