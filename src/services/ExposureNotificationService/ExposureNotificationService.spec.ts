/* eslint-disable require-atomic-updates */
import {when} from 'jest-when';
import {mock} from 'jest-mock-extended';

import {periodSinceEpoch} from '../../shared/date-fns';
import {BackendInterface} from '../BackendService';
import {I18n} from '../../locale';
import ExposureNotification, {Status as SystemStatus} from '../../bridge/ExposureNotification';

import {
  ExposureNotificationService,
  EXPOSURE_STATUS,
  HOURS_PER_PERIOD,
  PersistencyProvider,
  SecurePersistencyProvider,
} from './ExposureNotificationService';

jest.mock('react-native-zip-archive', () => ({
  unzip: jest.fn(),
}));

const server: BackendInterface = {
  retrieveDiagnosisKeys: jest.fn().mockResolvedValue(null),
  getExposureConfiguration: jest.fn().mockResolvedValue({}),
  claimOneTimeCode: jest.fn(),
  reportDiagnosisKeys: jest.fn(),
};
const i18n: I18n = {
  translate: jest.fn().mockReturnValue('foo'),
  locale: 'en',
};
const storage = mock<PersistencyProvider>();
const secureStorage: SecurePersistencyProvider = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValueOnce(undefined),
};
const bridge: typeof ExposureNotification = {
  detectExposure: jest.fn().mockResolvedValue({matchedKeyCount: 0}),
  start: jest.fn().mockResolvedValue(undefined),
  getTemporaryExposureKeyHistory: jest.fn().mockResolvedValue({}),
  getStatus: jest.fn().mockResolvedValue('active'),
  getExposureInformation: jest.fn(),
  getPendingExposureSummary: jest.fn(),
  resetAllData: jest.fn(),
  stop: jest.fn(),
};

/**
 * Utils for comparing jsonString
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Expect {
      jsonStringContaining<E = {}>(obj: E): any;
    }
  }
}
expect.extend({
  jsonStringContaining(jsonString, partial) {
    const json = JSON.parse(jsonString);
    const pass =
      Object.keys(partial).filter(key => JSON.stringify(partial[key]) !== JSON.stringify(json[key])).length === 0;
    if (!pass) {
      return {
        pass,
        message: () => `expect ${jsonString} to contain ${partial}`,
      };
    }
    return {
      message: () => '',
      pass,
    };
  },
});

describe('ExposureNotificationService', () => {
  let service: ExposureNotificationService;

  const OriginalDate = global.Date;
  const dateSpy = jest.spyOn(global, 'Date');
  beforeEach(() => {
    service = new ExposureNotificationService(server, i18n, storage, secureStorage, bridge);
  });

  afterEach(() => {
    jest.clearAllMocks();
    // TODO: enable this later
    // jest.resetAllMocks();
    dateSpy.mockReset();
  });

  describe('init', () => {
    it('has proper initial value', () => {
      expect(service.systemStatus.get()).toStrictEqual(SystemStatus.Undefined);
      expect(service.exposureStatus.get()).toStrictEqual(expect.objectContaining({type: 'monitoring'}));
    });

    it('observes exposureStatus and saves to storage', () => {
      service.exposureStatus.set({
        type: 'diagnosed',
      });

      expect(storage.setItem).toHaveBeenCalledWith(
        EXPOSURE_STATUS,
        expect.jsonStringContaining({
          type: 'diagnosed',
        }),
      );
    });
  });

  describe('start', () => {
    it('loads exposureStatus from storage', async () => {
      when(storage.getItem)
        .calledWith(EXPOSURE_STATUS)
        .mockResolvedValue(
          JSON.stringify({
            type: 'diagnosed',
          }),
        );
      expect(service.exposureStatus.get()).toStrictEqual(
        expect.objectContaining({
          type: 'monitoring',
        }),
      );

      await service.start();

      expect(service.exposureStatus.get()).toStrictEqual(
        expect.objectContaining({
          type: 'diagnosed',
        }),
      );
    });

    it('calls exposure notification start', async () => {
      await service.start();

      expect(bridge.start).toHaveBeenCalled();
    });

    class CountDownLatch {
      private resolver: Promise<void>;
      private resolve: () => void;

      constructor(countDown: number) {
        if (countDown <= 0) {
          throw new Error('Countdown needs to be larger than 0');
        }
        let i = countDown;
        this.resolver = new Promise(resolve => {
          this.resolve = () => {
            i -= 1;
            if (i > 0) {
              return;
            }
            resolve();
          };
        });
      }

      await() {
        return this.resolver;
      }

      countDown(promise?: Promise<any>) {
        if (promise) {
          promise?.then(() => this.resolve());
          return;
        }
        this.resolve();
      }
    }

    it('prevent calling exposure notification start multiple times while it is starting', async () => {
      const countDownLatch = new CountDownLatch(2);

      countDownLatch.countDown(service.start());
      countDownLatch.countDown(service.start());

      await countDownLatch.await();

      expect(bridge.start).toHaveBeenCalledTimes(1);
    });
  });

  it('backfills keys when last timestamp not available', async () => {
    dateSpy
      .mockImplementationOnce(() => new OriginalDate('2020-05-19T07:10:00+0000'))
      .mockImplementation((args: any) => new OriginalDate(args));

    await service.updateExposureStatus();
    expect(server.retrieveDiagnosisKeys).toHaveBeenCalledTimes(1);
  });

  it('backfills the right amount of keys for current day', async () => {
    dateSpy.mockImplementation((args: any) => {
      if (args === undefined) return new OriginalDate('2020-05-19T11:10:00+0000');
      return new OriginalDate(args);
    });

    service.exposureStatus.append({
      lastChecked: {
        timestamp: new OriginalDate('2020-05-19T06:10:00+0000').getTime(),
        period: periodSinceEpoch(new OriginalDate('2020-05-19T06:10:00+0000'), HOURS_PER_PERIOD),
      },
    });
    await service.updateExposureStatus();
    expect(server.retrieveDiagnosisKeys).toHaveBeenCalledTimes(1);

    server.retrieveDiagnosisKeys.mockClear();

    service.exposureStatus.append({
      lastChecked: {
        timestamp: new OriginalDate('2020-05-18T05:10:00+0000').getTime(),
        period: periodSinceEpoch(new OriginalDate('2020-05-18T05:10:00+0000'), HOURS_PER_PERIOD),
      },
    });
    await service.updateExposureStatus();
    expect(server.retrieveDiagnosisKeys).toHaveBeenCalledTimes(2);

    server.retrieveDiagnosisKeys.mockClear();

    service.exposureStatus.append({
      lastChecked: {
        timestamp: new OriginalDate('2020-05-17T23:10:00+0000').getTime(),
        period: periodSinceEpoch(new OriginalDate('2020-05-17T23:10:00+0000'), HOURS_PER_PERIOD),
      },
    });
    await service.updateExposureStatus();
    expect(server.retrieveDiagnosisKeys).toHaveBeenCalledTimes(3);
  });

  it('serializes status update', async () => {
    const updatePromise = service.updateExposureStatus();
    const anotherUpdatePromise = service.updateExposureStatus();
    await Promise.all([updatePromise, anotherUpdatePromise]);
    expect(server.getExposureConfiguration).toHaveBeenCalledTimes(1);
  });

  it('stores last update timestamp', async () => {
    const currentDatetime = new OriginalDate('2020-05-19T07:10:00+0000');
    dateSpy.mockImplementation((args: any) => {
      if (args === undefined) return currentDatetime;
      return new OriginalDate(args);
    });

    service.exposureStatus.append({
      lastChecked: {
        timestamp: new OriginalDate('2020-05-18T04:10:00+0000').getTime(),
        period: periodSinceEpoch(new OriginalDate('2020-05-18T04:10:00+0000'), HOURS_PER_PERIOD),
      },
    });

    const currentPeriod = periodSinceEpoch(currentDatetime, HOURS_PER_PERIOD);
    when(server.retrieveDiagnosisKeys)
      .calledWith(currentPeriod)
      .mockRejectedValue(null);

    await service.updateExposureStatus();

    expect(storage.setItem).toHaveBeenCalledWith(
      EXPOSURE_STATUS,
      expect.jsonStringContaining({
        lastChecked: {
          timestamp: currentDatetime.getTime(),
          period: currentPeriod - 1,
        },
      }),
    );
  });

  it('enters Diagnosed flow when start keys submission process', async () => {
    dateSpy.mockImplementation(() => {
      return new OriginalDate();
    });
    when(server.claimOneTimeCode)
      .calledWith('12345678')
      .mockResolvedValue({
        serverPublicKey: 'serverPublicKey',
        clientPrivateKey: 'clientPrivateKey',
        clientPublicKey: 'clientPublicKey',
      });

    await service.startKeysSubmission('12345678');
    expect(service.exposureStatus.get()).toStrictEqual(
      expect.objectContaining({
        type: 'diagnosed',
        cycleEndsAt: expect.any(Number),
        needsSubmission: true,
      }),
    );
  });

  it('restores "diagnosed" status from storage', async () => {
    when(storage.getItem)
      .calledWith(EXPOSURE_STATUS)
      .mockResolvedValueOnce(
        JSON.stringify({
          type: 'diagnosed',
          cycleStartsAt: new OriginalDate('2020-05-18T04:10:00+0000').toString(),
        }),
      );
    dateSpy.mockImplementation((...args) =>
      args.length > 0 ? new OriginalDate(...args) : new OriginalDate('2020-05-19T04:10:00+0000'),
    );

    await service.start();

    expect(service.exposureStatus.get()).toStrictEqual(
      expect.objectContaining({
        type: 'diagnosed',
      }),
    );
  });

  describe('NeedsSubmission status calculated initially', () => {
    beforeEach(() => {
      dateSpy.mockImplementation((...args) =>
        args.length > 0 ? new OriginalDate(...args) : new OriginalDate('2020-05-19T04:10:00+0000'),
      );
      service.exposureStatus.append({
        type: 'diagnosed',
        cycleStartsAt: new OriginalDate('2020-05-14T04:10:00+0000').getTime(),
      });
    });

    it('for positive', async () => {
      service.exposureStatus.append({
        submissionLastCompletedAt: new OriginalDate('2020-05-18T04:10:00+0000').getTime(),
      });

      await service.start();
      expect(service.exposureStatus.get()).toStrictEqual(
        expect.objectContaining({
          needsSubmission: true,
        }),
      );
    });

    it('for negative', async () => {
      service.exposureStatus.append({
        submissionLastCompletedAt: new OriginalDate('2020-05-19T04:10:00+0000').getTime(),
      });

      await service.start();
      expect(service.exposureStatus.get()).toStrictEqual(
        expect.objectContaining({
          needsSubmission: false,
        }),
      );
    });
  });

  it('needsSubmission status recalculates daily', async () => {
    let currentDateString = '2020-05-19T04:10:00+0000';

    service.exposureStatus.append({
      type: 'diagnosed',
      needsSubmission: false,
      cycleStartsAt: new OriginalDate('2020-05-14T04:10:00+0000').getTime(),
      cycleEndsAt: new OriginalDate('2020-05-28T04:10:00+0000').getTime(),
      submissionLastCompletedAt: null,
    });

    dateSpy.mockImplementation((...args) =>
      args.length > 0 ? new OriginalDate(...args) : new OriginalDate(currentDateString),
    );

    await service.start();
    await service.updateExposureStatus();
    expect(service.exposureStatus.get()).toStrictEqual(
      expect.objectContaining({type: 'diagnosed', needsSubmission: true}),
    );

    currentDateString = '2020-05-20T04:10:00+0000';
    when(secureStorage.get)
      .calledWith('submissionAuthKeys')
      .mockResolvedValueOnce('{}');
    await service.fetchAndSubmitKeys();

    expect(storage.setItem).toHaveBeenCalledWith(
      EXPOSURE_STATUS,
      expect.jsonStringContaining({
        submissionLastCompletedAt: new OriginalDate(currentDateString).getTime(),
      }),
    );

    expect(service.exposureStatus.get()).toStrictEqual(
      expect.objectContaining({type: 'diagnosed', needsSubmission: false}),
    );

    service.exposureStatus.append({
      submissionLastCompletedAt: new OriginalDate(currentDateString).getTime(),
    });

    // advance day forward
    currentDateString = '2020-05-21T04:10:00+0000';

    await service.updateExposureStatus();
    expect(service.exposureStatus.get()).toStrictEqual(
      expect.objectContaining({type: 'diagnosed', needsSubmission: true}),
    );

    // advance 14 days
    currentDateString = '2020-05-30T04:10:00+0000';
    service.exposureStatus.append({
      submissionLastCompletedAt: new OriginalDate('2020-05-28T04:10:00+0000').getTime(),
    });

    await service.updateExposureStatus();
    expect(service.exposureStatus.get()).toStrictEqual(expect.objectContaining({type: 'monitoring'}));
  });

  describe('updateExposureStatus', () => {
    it('keeps lastChecked when reset from diagnosed state to monitoring state', async () => {
      const today = new OriginalDate('2020-05-18T04:10:00+0000');
      dateSpy.mockImplementation((args: any) => (args ? new OriginalDate(args) : today));
      const period = periodSinceEpoch(today, HOURS_PER_PERIOD);
      service.exposureStatus.set({
        type: 'diagnosed',
        cycleStartsAt: today.getTime() - 14 * 3600 * 24 * 1000,
        cycleEndsAt: today.getTime(),
        lastChecked: {
          period,
          timestamp: today.getTime(),
        },
      });

      await service.updateExposureStatus();

      expect(service.exposureStatus.get()).toStrictEqual(
        expect.objectContaining({
          lastChecked: {
            period,
            timestamp: today.getTime(),
          },
          type: 'monitoring',
        }),
      );
    });

    it('keeps lastChecked when reset from exposed state to monitoring state', async () => {
      const today = new OriginalDate('2020-05-18T04:10:00+0000');
      dateSpy.mockImplementation((...args: any[]) => (args.length > 0 ? new OriginalDate(...args) : today));
      const period = periodSinceEpoch(today, HOURS_PER_PERIOD);
      service.exposureStatus.set({
        type: 'exposed',
        lastChecked: {
          period,
          timestamp: today.getTime(),
        },
        summary: {
          daysSinceLastExposure: 2,
          lastExposureTimestamp: today.getTime() - 14 * 3600 * 24 * 1000,
          matchedKeyCount: 1,
          maximumRiskScore: 1,
        },
      });

      await service.updateExposureStatus();

      expect(service.exposureStatus.get()).toStrictEqual(
        expect.objectContaining({
          lastChecked: {
            period,
            timestamp: today.getTime(),
          },
          type: 'monitoring',
        }),
      );
    });

    it('does not reset to monitoring state when lastExposureTimestamp is not available', async () => {
      const today = new OriginalDate('2020-05-18T04:10:00+0000');
      dateSpy.mockImplementation((...args: any[]) => (args.length > 0 ? new OriginalDate(...args) : today));
      const period = periodSinceEpoch(today, HOURS_PER_PERIOD);
      service.exposureStatus.set({
        type: 'exposed',
        lastChecked: {
          period,
          timestamp: today.getTime(),
        },
        summary: {
          daysSinceLastExposure: 2,
          lastExposureTimestamp: 0,
          matchedKeyCount: 1,
          maximumRiskScore: 1,
        },
      });

      await service.updateExposureStatus();

      expect(service.exposureStatus.get()).toStrictEqual(
        expect.objectContaining({
          type: 'exposed',
          lastChecked: {
            period,
            timestamp: today.getTime(),
          },
          summary: {
            daysSinceLastExposure: 2,
            lastExposureTimestamp: 0,
            matchedKeyCount: 1,
            maximumRiskScore: 1,
          },
        }),
      );
    });

    it('selects ExposureSummary that has larger lastExposureTimestamp', async () => {
      const today = new OriginalDate('2020-05-18T04:10:00+0000');
      dateSpy.mockImplementation((...args: any[]) => (args.length > 0 ? new OriginalDate(...args) : today));
      const period = periodSinceEpoch(today, HOURS_PER_PERIOD);
      service.exposureStatus.set({
        type: 'exposed',
        lastChecked: {
          period,
          timestamp: today.getTime(),
        },
        summary: {
          daysSinceLastExposure: 8,
          lastExposureTimestamp: today.getTime() - 8 * 3600 * 24 * 1000,
          matchedKeyCount: 1,
          maximumRiskScore: 1,
        },
      });
      bridge.detectExposure.mockResolvedValue({
        daysSinceLastExposure: 7,
        lastExposureTimestamp: today.getTime() - 7 * 3600 * 24 * 1000,
        matchedKeyCount: 1,
        maximumRiskScore: 1,
      });

      await service.updateExposureStatus();

      expect(service.exposureStatus.get()).toStrictEqual(
        expect.objectContaining({
          type: 'exposed',
          summary: {
            daysSinceLastExposure: 7,
            lastExposureTimestamp: today.getTime() - 7 * 3600 * 24 * 1000,
            matchedKeyCount: 1,
            maximumRiskScore: 1,
          },
        }),
      );
    });

    it('ignores ExposureSummary that has smaller lastExposureTimestamp', async () => {
      const today = new OriginalDate('2020-05-18T04:10:00+0000');
      dateSpy.mockImplementation((...args: any[]) => (args.length > 0 ? new OriginalDate(...args) : today));
      const period = periodSinceEpoch(today, HOURS_PER_PERIOD);
      service.exposureStatus.set({
        type: 'exposed',
        lastChecked: {
          period,
          timestamp: today.getTime(),
        },
        summary: {
          daysSinceLastExposure: 8,
          lastExposureTimestamp: today.getTime() - 8 * 3600 * 24 * 1000,
          matchedKeyCount: 1,
          maximumRiskScore: 1,
        },
      });
      bridge.detectExposure.mockResolvedValue({
        daysSinceLastExposure: 9,
        lastExposureTimestamp: today.getTime() - 9 * 3600 * 24 * 1000,
        matchedKeyCount: 1,
        maximumRiskScore: 1,
      });

      await service.updateExposureStatus();

      expect(service.exposureStatus.get()).toStrictEqual(
        expect.objectContaining({
          type: 'exposed',
          summary: {
            daysSinceLastExposure: 8,
            lastExposureTimestamp: today.getTime() - 8 * 3600 * 24 * 1000,
            matchedKeyCount: 1,
            maximumRiskScore: 1,
          },
        }),
      );
    });
  });
});
