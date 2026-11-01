import os
from setuptools import find_packages, setup

setup(
    name=os.environ.get('PKG_NAME'),
    version=os.environ.get('PKG_VERSION'),
    packages=find_packages(exclude=["contrib", "docs", "test"]),
)
