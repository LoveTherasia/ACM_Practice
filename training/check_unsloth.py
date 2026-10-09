try:
    import unsloth  # noqa: F401
    print("unsloth import OK")
except Exception as e:
    print("unsloth import FAILED:", e)
