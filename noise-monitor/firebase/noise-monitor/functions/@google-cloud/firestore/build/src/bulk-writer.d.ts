/*!
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import * as firestore from '@google-cloud/firestore';
import { FieldPath, Firestore } from '.';
import { RateLimiter } from './rate-limiter';
import { Timestamp } from './timestamp';
import { WriteBatch, WriteResult } from './write-batch';
import { GoogleError } from 'google-gax';
import GrpcStatus = FirebaseFirestore.GrpcStatus;
/*!
 * The starting maximum number of operations per second as allowed by the
 * 500/50/5 rule.
 *
 * https://cloud.google.com/datastore/docs/best-practices#ramping_up_traffic.
 */
export declare const DEFAULT_STARTING_MAXIMUM_OPS_PER_SECOND = 500;
/**
 * Represents a single write for BulkWriter, encapsulating operation dispatch
 * and error handling.
 * @private
 */
declare class BulkWriterOperation {
    readonly ref: firestore.DocumentReference<unknown>;
    private readonly type;
    private readonly sendFn;
    private readonly errorFn;
    private readonly successFn;
    private deferred;
    private failedAttempts;
    /**
     * @param ref The document reference being written to.
     * @param type The type of operation that created this write.
     * @param sendFn A callback to invoke when the operation should be sent.
     * @param errorFn The user provided global error callback.
     * @param successFn The user provided global success callback.
     */
    constructor(ref: firestore.DocumentReference<unknown>, type: 'create' | 'set' | 'update' | 'delete', sendFn: (op: BulkWriterOperation) => void, errorFn: (error: BulkWriterError) => boolean, successFn: (ref: firestore.DocumentReference<unknown>, result: WriteResult) => void);
    get promise(): Promise<WriteResult>;
    onError(error: GoogleError): void;
    onSuccess(result: WriteResult): void;
}
/**
 * Used to represent a batch on the BatchQueue.
 *
 * @private
 */
declare class BulkCommitBatch extends WriteBatch {
    readonly docPaths: Set<string>;
    private pendingOps;
    has(documentRef: firestore.DocumentReference<unknown>): boolean;
    bulkCommit(options?: {
        requestTag?: string;
    }): Promise<void>;
    /**
     * Helper to update data structures associated with the operation and returns
     * the result.
     */
    processLastOperation(op: BulkWriterOperation): void;
}
/**
 * The error thrown when a BulkWriter operation fails.
 *
 * @class BulkWriterError
 */
export declare class BulkWriterError extends Error {
    /** The status code of the error. */
    readonly code: GrpcStatus;
    /** The error message of the error. */
    readonly message: string;
    /** The document reference the operation was performed on. */
    readonly documentRef: firestore.DocumentReference<unknown>;
    /** The type of operation performed. */
    readonly operationType: 'create' | 'set' | 'update' | 'delete';
    /** How many times this operation has been attempted unsuccessfully. */
    readonly failedAttempts: number;
    /** @hideconstructor */
    constructor(
    /** The status code of the error. */
    code: GrpcStatus, 
    /** The error message of the error. */
    message: string, 
    /** The document reference the operation was performed on. */
    documentRef: firestore.DocumentReference<unknown>, 
    /** The type of operation performed. */
    operationType: 'create' | 'set' | 'update' | 'delete', 
    /** How many times this operation has been attempted unsuccessfully. */
    failedAttempts: number);
}
/**
 * A Firestore BulkWriter that can be used to perform a large number of writes
 * in parallel.
 *
 * @class BulkWriter
 */
export declare class BulkWriter {
    private readonly firestore;
    /**
     * The maximum number of writes that can be in a single batch.
     * Visible for testing.
     * @private
     */
    _maxBatchSize: number;
    /**
     * The batch that is currently used to schedule operations. Once this batch
     * reaches maximum capacity, a new batch is created.
     * @private
     */
    private _bulkCommitBatch;
    /**
     * A pointer to the tail of all active BulkWriter applications. This pointer
     * is advanced every time a new write is enqueued.
     * @private
     */
    private _lastOp;
    /**
     * Whether this BulkWriter instance has started to close. Afterwards, no
     * new operations can be enqueued, except for retry operations scheduled by
     * the error handler.
     * @private
     */
    private _closing;
    /**
     * Rate limiter used to throttle requests as per the 500/50/5 rule.
     * Visible for testing.
     * @private
     */
    readonly _rateLimiter: RateLimiter;
    /**
     * The user-provided callback to be run every time a BulkWriter operation
     * successfully completes.
     * @private
     */
    private _successFn;
    /**
     * The user-provided callback to be run every time a BulkWriter operation
     * fails.
     * @private
     */
    private _errorFn;
    /** @hideconstructor */
    constructor(firestore: Firestore, options?: firestore.BulkWriterOptions);
    /**
     * Create a document with the provided data. This single operation will fail
     * if a document exists at its location.
     *
     * @param {DocumentReference} documentRef A reference to the document to be
     * created.
     * @param {T} data The object to serialize as the document.
     * @returns {Promise<WriteResult>} A promise that resolves with the result of
     * the write. If the write fails, the promise is rejected with a
     * [BulkWriterError]{@link BulkWriterError}.
     *
     * @example
     * let bulkWriter = firestore.bulkWriter();
     * let documentRef = firestore.collection('col').doc();
     *
     * bulkWriter
     *  .create(documentRef, {foo: 'bar'})
     *  .then(result => {
     *    console.log('Successfully executed write at: ', result);
     *  })
     *  .catch(err => {
     *    console.log('Write failed with: ', err);
     *  });
     * });
     */
    create<T>(documentRef: firestore.DocumentReference<T>, data: T): Promise<WriteResult>;
    /**
     * Delete a document from the database.
     *
     * @param {DocumentReference} documentRef A reference to the document to be
     * deleted.
     * @param {Precondition=} precondition A precondition to enforce for this
     * delete.
     * @param {Timestamp=} precondition.lastUpdateTime If set, enforces that the
     * document was last updated at lastUpdateTime. Fails the batch if the
     * document doesn't exist or was last updated at a different time.
     * @returns {Promise<WriteResult>} A promise that resolves with the result of
     * the delete. If the delete fails, the promise is rejected with a
     * [BulkWriterError]{@link BulkWriterError}.
     *
     * @example
     * let bulkWriter = firestore.bulkWriter();
     * let documentRef = firestore.doc('col/doc');
     *
     * bulkWriter
     *  .delete(documentRef)
     *  .then(result => {
     *    console.log('Successfully deleted document');
     *  })
     *  .catch(err => {
     *    console.log('Delete failed with: ', err);
     *  });
     * });
     */
    delete<T>(documentRef: firestore.DocumentReference<T>, precondition?: firestore.Precondition): Promise<WriteResult>;
    set<T>(documentRef: firestore.DocumentReference<T>, data: Partial<T>, options: firestore.SetOptions): Promise<WriteResult>;
    set<T>(documentRef: firestore.DocumentReference<T>, data: T): Promise<WriteResult>;
    /**
     * Update fields of the document referred to by the provided
     * [DocumentReference]{@link DocumentReference}. If the document doesn't yet
     * exist, the update fails and the entire batch will be rejected.
     *
     * The update() method accepts either an object with field paths encoded as
     * keys and field values encoded as values, or a variable number of arguments
     * that alternate between field paths and field values. Nested fields can be
     * updated by providing dot-separated field path strings or by providing
     * FieldPath objects.
     *
     *
     * A Precondition restricting this update can be specified as the last
     * argument.
     *
     * @param {DocumentReference} documentRef A reference to the document to be
     * updated.
     * @param {UpdateData|string|FieldPath} dataOrField An object containing the
     * fields and values with which to update the document or the path of the
     * first field to update.
     * @param {...(Precondition|*|string|FieldPath)} preconditionOrValues - An
     * alternating list of field paths and values to update or a Precondition to
     * restrict this update
     * @returns {Promise<WriteResult>} A promise that resolves with the result of
     * the write. If the write fails, the promise is rejected with a
     * [BulkWriterError]{@link BulkWriterError}.
     *
     * @example
     * let bulkWriter = firestore.bulkWriter();
     * let documentRef = firestore.doc('col/doc');
     *
     * bulkWriter
     *  .update(documentRef, {foo: 'bar'})
     *  .then(result => {
     *    console.log('Successfully executed write at: ', result);
     *  })
     *  .catch(err => {
     *    console.log('Write failed with: ', err);
     *  });
     * });
     */
    update<T>(documentRef: firestore.DocumentReference<T>, dataOrField: firestore.UpdateData | string | FieldPath, ...preconditionOrValues: Array<{
        lastUpdateTime?: Timestamp;
    } | unknown | string | FieldPath>): Promise<WriteResult>;
    /**
     * Attaches a listener that is run every time a BulkWriter operation
     * successfully completes.
     *
     * @param callback A callback to be called every time a BulkWriter operation
     * successfully completes.
     * @example
     * let bulkWriter = firestore.bulkWriter();
     *
     * bulkWriter
     *   .onWriteResult((documentRef, result) => {
     *     console.log(
     *       'Successfully executed write on document: ',
     *       documentRef,
     *       ' at: ',
     *       result
     *     );
     *   });
     */
    onWriteResult(callback: (documentRef: firestore.DocumentReference<unknown>, result: WriteResult) => void): void;
    /**
     * Attaches an error handler listener that is run every time a BulkWriter
     * operation fails.
     *
     * BulkWriter has a default error handler that retries UNAVAILABLE and
     * ABORTED errors up to a maximum of 10 failed attempts. When an error
     * handler is specified, the default error handler will be overwritten.
     *
     * @param shouldRetryCallback A callback to be called every time a BulkWriter
     * operation fails. Returning `true` will retry the operation. Returning
     * `false` will stop the retry loop.
     * @example
     * let bulkWriter = firestore.bulkWriter();
     *
     * bulkWriter
     *   .onWriteError((error) => {
     *     if (
     *       error.code === GrpcStatus.UNAVAILABLE &&
     *       error.failedAttempts < MAX_RETRY_ATTEMPTS
     *     ) {
     *       return true;
     *     } else {
     *       console.log('Failed write at document: ', error.documentRef);
     *       return false;
     *     }
     *   });
     */
    onWriteError(shouldRetryCallback: (error: BulkWriterError) => boolean): void;
    /**
     * Commits all writes that have been enqueued up to this point in parallel.
     *
     * Returns a Promise that resolves when all currently queued operations have
     * been committed. The Promise will never be rejected since the results for
     * each individual operation are conveyed via their individual Promises.
     *
     * The Promise resolves immediately if there are no pending writes. Otherwise,
     * the Promise waits for all previously issued writes, but it does not wait
     * for writes that were added after the method is called. If you want to wait
     * for additional writes, call `flush()` again.
     *
     * @return {Promise<void>} A promise that resolves when all enqueued writes
     * up to this point have been committed.
     *
     * @example
     * let bulkWriter = firestore.bulkWriter();
     *
     * bulkWriter.create(documentRef, {foo: 'bar'});
     * bulkWriter.update(documentRef2, {foo: 'bar'});
     * bulkWriter.delete(documentRef3);
     * await flush().then(() => {
     *   console.log('Executed all writes');
     * });
     */
    flush(): Promise<void>;
    /**
     * Commits all enqueued writes and marks the BulkWriter instance as closed.
     *
     * After calling `close()`, calling any method wil throw an error. Any
     * retries scheduled as part of an `onWriteError()` handler will be run
     * before the `close()` promise resolves.
     *
     * Returns a Promise that resolves when there are no more pending writes. The
     * Promise will never be rejected. Calling this method will send all requests.
     * The promise resolves immediately if there are no pending writes.
     *
     * @return {Promise<void>} A promise that resolves when all enqueued writes
     * up to this point have been committed.
     *
     * @example
     * let bulkWriter = firestore.bulkWriter();
     *
     * bulkWriter.create(documentRef, {foo: 'bar'});
     * bulkWriter.update(documentRef2, {foo: 'bar'});
     * bulkWriter.delete(documentRef3);
     * await close().then(() => {
     *   console.log('Executed all writes');
     * });
     */
    close(): Promise<void>;
    /**
     * Throws an error if the BulkWriter instance has been closed.
     * @private
     */
    private _verifyNotClosed;
    /**
     * Sends the current batch and resets `this._bulkCommitBatch`.
     *
     * @param flush If provided, keeps re-sending operations until no more
     * operations are enqueued. This allows retries to resolve as part of a
     * `flush()` or `close()` call.
     * @private
     */
    private _sendCurrentBatch;
    /**
     * Schedules and runs the provided operation on the next available batch.
     * @private
     */
    private _enqueue;
    /**
     * Schedules the provided operations on current BulkCommitBatch.
     * Sends the BulkCommitBatch if it reaches maximum capacity.
     *
     * @private
     */
    _sendFn(enqueueOnBatchCallback: (bulkCommitBatch: BulkCommitBatch) => void, op: BulkWriterOperation): void;
}
export {};