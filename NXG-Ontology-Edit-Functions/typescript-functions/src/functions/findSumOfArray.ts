import { Integer } from "@osdk/functions";

function findSumOfArray(numbers: Integer[]): Integer {
    return numbers.reduce((acc, num) => acc + num, 0);
}

// // To test this function in Live Preview and later publish to the platform, make it the default export of the file.
// export default findSumOfArray;
