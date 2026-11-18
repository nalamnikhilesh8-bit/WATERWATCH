from django.db import migrations


def mark_seed_placeholders(apps, schema_editor):
    ReportImage = apps.get_model("reports", "ReportImage")
    database = schema_editor.connection.alias
    ReportImage.objects.using(database).filter(
        stage="BEFORE",
        image__contains="demo-",
    ).update(is_demo_placeholder=True)


class Migration(migrations.Migration):
    dependencies = [("reports", "0002_leakreport_ai_classifier_method_and_more")]

    operations = [migrations.RunPython(mark_seed_placeholders, migrations.RunPython.noop)]
