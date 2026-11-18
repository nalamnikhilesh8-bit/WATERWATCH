try:
    import MySQLdb  # mysqlclient
except ImportError:
    try:
        import pymysql
        pymysql.install_as_MySQLdb()
    except ImportError:
        # Django will explain that a MySQL driver is required if the backend is selected.
        pass
