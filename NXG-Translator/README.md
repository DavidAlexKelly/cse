## Python Functions

To get started, open repo://python-functions/python/python_functions/my_function.py and uncomment one of the example functions.

A basic function looks like:

```python
from functions.api import function, String

@function
def my_function() -> String:
    return "Hello World!"
```

Notice that the function adheres to the following constraints:

1. It must be annotated with `@function` from the `functions.api` package to be recognized as a Function
    1. You may have multiple Python files with multiple functions in each file, but only the functions with this annotation will be registered as Functions and be usable in Builder pipelines
2. It must declare the types of all of its inputs and the type of its output, either using the type from the Functions API package or its corresponding Python type (see table below)
    1. e.g. the example’s output type is declared as `String` from the Functions API, but it may also be declared as the corresponding Python type `str`


**Note: Even if you declare the type of an argument with the API type (e.g. `String`), your function will be passed the corresponding Python type at runtime (e.g. `str`).**

### Supported Types

#### Primitive API Types

Below is the full list of currently supported primitive Functions API types, their corresponding Python types, and whether that type can be declared using its corresponding Python type instead of the Functions API type:

| Functions API Type | Can Declare as Python Type? | Corresponding Python Type |
|--------------------|-----------------------------|---------------------------|
| Array¹             | ✅                           | list                      |
| Binary             | ✅                           | bytes                     |
| Boolean            | ✅                           | bool                      |
| Byte²              | ❌                           | int                       |
| Date               | ✅                           | datetime.date             |
| Decimal            | ✅                           | decimal.Decimal           |
| Double³            | ❌                           | float                     |
| Float              | ✅                           | float                     |
| Integer            | ✅                           | int                       |
| Long²              | ❌                           | int                       |
| Map¹               | ✅                           | dict                      |
| Optional¹          | ✅                           | typing.Optional           |
| Set¹               | ✅                           | set                       |
| Short²             | ❌                           | int                       |
| String             | ✅                           | str                       |
| Timestamp          | ✅                           | datetime.datetime         |

___

1. `Array`, `Map`, `Optional`, and `Set` are generic types that must be parameterized by other types. For example, `Array[String]` is a list of strings, `Map[String, Integer]` is a dictionary with string keys and integer values, and `Optional[String]` is an optional string. The parameterized types must be specified and the type must be one of the supported types in the table above. Additionally, map keys may not be any of the generic types.
2. Any fields annotated with the native Python type `int` will be registered with type `Integer`. The other integer types from the API (`Byte`, `Integer`, `Long`, and `Short`) must be used explicitly to register fields with those types. 
3. Any fields annotated with the native Python type `float` will be registered with type `Float`.  The `Double` type from the API must be used explicitly to register fields with that type.

#### Object Types

In addition to primitive types, the Functions API also supports Object type inputs and outputs. After generating a
Python Ontology SDK client as described below in **Using the Python Ontology SDK**, you can create functions that accept
and return the Object types present in your Ontology.

#### Custom Types

Custom Python classes composed of other supported types can also be used in Function signatures.
There isn't an explicit `Custom` type in the API package, instead these types are declared as user-defined Python classes.
To be valid as a custom type, the class must have type annotations on all of its fields, the field types must be supported types (either the primitive API types or native Python types as defined in the table above may be used), and the `__init__` method must accept only named arguments with the same names and type annotations as the fields.
The `dataclasses.dataclass` decorator can be used to automatically generate the `__init__` method that conforms with these requirements.

Here's an example of a valid custom type:

```python
from functions.api import function
from dataclasses import dataclass
from datetime import datetime

@dataclass
class Event:
    timestamp: datetime
    message: str
    
@function
def get_event_message(event: Event) -> str:
    return event.message
```

Or alternatively without the dataclass decorator and using API types:
    
 ```python
 from functions.api import function, String, Timestamp

 class Event:
     timestamp: Timestamp
     message: String

     def __init__(
         self, 
         timestamp: Timestamp, 
         message: String
      ):
         self.timestamp = timestamp
         self.message = message

 @function
 def get_event_message(event: Event) -> String:
     return event.message
 ```

### Additional Example Function Declarations

Another example function with inputs is shown below:

```python
from functions.api import function, Long, String, Timestamp

@function
def get_end_day_of_week(start_time: Timestamp, elapsed_millis: Long) -> String:
   # function logic here
   pass
```

As seen in the above table, this function could also be declared using only built-in Python types:

```python
from functions.api import function
from datetime import datetime

@function
def get_end_day_of_week(start_time: datetime, elapsed_millis: int) -> str:
   # function logic here
   pass
```

Or using a combination of built-in and API types:

```python
from functions.api import function, Long, String
from datetime import datetime

@function
def get_end_day_of_week(start_time: datetime, elapsed_millis: Long) -> String:
   # function logic here
   pass
```

Here's an example using generic, built-in, and API types:

```python
from functions.api import function, Array, String
from typing import Optional

@function
def get_first_element(arr: Array[String]) -> Optional[str]:
    if len(arr) == 0:
        return None
    return arr[0]
```

### Using Python Libraries

If you want to use Python libraries in your code, you can either add the name of the library to the `requirements` → `run` section of the `meta.yaml` file.
Or you can navigate to the `Libraries` section of the sidebar, search for the library, and select the `Add Library`.

### Tagging a Version

For your functions to be usable in Builder, you must first tag a version of them. First, select the `Tag Version` button.
And then choose what you want this version of your functions to be called.
Once you press `Tag and Release`, you can click the `View` button to be taken to monitor the progress of the release.
If your release succeeds, you should be able to see all the functions published from the `Tags and releases` section of the `Branches` tab.
Otherwise, you can inspect the failed build to see the error that occurred.


## Using the Python Ontology SDK

You can write functions that interact with the Foundry Ontology using the Python Ontology SDK.

To generate a Python Ontology SDK client, navigate to the `Resource imports` section of the left sidebar, and select
`Add -> Ontology`. From there, select your desired Ontology, and then import any Objects and Links you would like
access to in your functions. After saving to confirm your selections, you will be prompted to generate and install 
an Ontology SDK package on the `SDK generation` tab. See the [Python functions on objects documentation](https://www.palantir.com/docs/foundry/functions/python-functions-on-objects)
for more details on generating and using the Python Ontology SDK in a function.

For example, if you imported an Object called `Aircraft` with properties `brand` and `capacity`, you could write a
function that accepts an `Aircraft` object and summarizes it like so:

```python
from functions.api import function
from ontology_sdk.ontology.objects import Aircraft

@function
def aircraft_input_example(aircraft: Aircraft) -> str:
    return f"{aircraft.brand} aircraft, holds {aircraft.capacity} passengers"
```

Furthermore, if you wanted to search for `Aircraft` objects satisfying a certain capacity threshold, you could write the
following:

```python
from functions.api import function
from ontology_sdk import FoundryClient
from ontology_sdk.ontology.objects import Aircraft
from ontology_sdk.ontology.object_sets import AircraftObjectSet

@function
def aircraft_search_example() -> AircraftObjectSet:
    return FoundryClient().ontology.objects.Aircraft.where(Aircraft.object_type.capacity > 100)
```

The Python OSDK also provides beta features such as interoperability with pandas DataFrames:

```python
from functions.api import function
from ontology_sdk.ontology.object_sets import AircraftObjectSet

@function
def aircraft_dataframe_example(aircrafts: AircraftObjectSet) -> int:
    df = aircrafts.to_dataframe()
    return df['capacity'].sum()
```

See the [Palantir Foundry Python Ontology SDK documentation](https://www.palantir.com/docs/foundry/ontology-sdk/python-osdk/)
for more information about using the Python OSDK.

## Using Python Functions in Pipeline Builder

To import your functions in Pipeline Builder, go to `Reusables` → `User-defined functions`  → `Import UDF`.
Select your Function(s) from the list and select `Add`.
Now, your functions should be visible in the transform picker alongside built-in transforms to be used in your pipeline!

If you don't see the `User-defined functions` option or your functions are not visible in the import dialogue, UDFs or Function UDFs may not be enabled for your stack.
Please reach out to your administrator if you are interested in enabling this feature.

## Testing

To test your code, add the line `enablePytest = true` to the hidden `gradle.properties` file in your repository. This will
ensure that `pytest` is installed and will automatically discover and run any tests you have defined in your repository
during CI after each commit you make.

Ensure your test filenames and test function names start with `test_` so that they are discovered and executed by
`pytest`.
