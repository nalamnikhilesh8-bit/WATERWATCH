from django.db import migrations, models


def mark_seed_reports(apps, schema_editor):
    LeakReport = apps.get_model("reports", "LeakReport")
    LeakReport.objects.using(schema_editor.connection.alias).filter(title__startswith="Demo leak ").update(is_demo=True)


class Migration(migrations.Migration):
    dependencies = [("reports", "0003_mark_seed_placeholder_photos")]

    operations = [
        migrations.AddField(
            model_name="leakreport",
            name="is_demo",
            field=models.BooleanField(db_index=True, default=False),
        ),
        migrations.RunPython(mark_seed_reports, migrations.RunPython.noop),
    ]
